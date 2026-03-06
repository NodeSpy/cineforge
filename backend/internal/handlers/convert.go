package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"cineforge/internal/config"
	"cineforge/internal/conversions"
	"cineforge/internal/tmdb"
)

type ConvertRequest struct {
	Items    []map[string]interface{} `json:"items"`
	FileName string                   `json:"file_name"`
}

type ConvertMatch struct {
	OriginalTitle string       `json:"original_title"`
	OriginalYear  string       `json:"original_year"`
	Matches       []tmdb.Movie `json:"matches"`
	BestMatch     *tmdb.Movie  `json:"best_match,omitempty"`
	Status        string       `json:"status"` // "matched", "multiple", "not_found"
}

type ConvertResponse struct {
	Results []ConvertMatch `json:"results"`
	Total   int            `json:"total"`
	Matched int            `json:"matched"`
}

func ConvertTitles(w http.ResponseWriter, r *http.Request) {
	var req ConvertRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}

	if len(req.Items) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "No items provided"})
		return
	}

	cfg, err := config.Get()
	if err != nil || config.SecretForUse(cfg.TMDbAPIKey) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "TMDb API key not configured"})
		return
	}

	client := tmdb.NewClient(config.SecretForUse(cfg.TMDbAPIKey))
	results := make([]ConvertMatch, 0, len(req.Items))
	matched := 0

	for _, item := range req.Items {
		result := processItem(client, item)
		if result.Status == "matched" {
			matched++
		}
		results = append(results, result)
	}

	writeJSON(w, http.StatusOK, ConvertResponse{
		Results: results,
		Total:   len(req.Items),
		Matched: matched,
	})
}

func processItem(client *tmdb.Client, item map[string]interface{}) ConvertMatch {
	title := extractString(item, "title", "name", "movie_title")
	year := extractYear(item)

	if title == "" {
		return ConvertMatch{
			OriginalTitle: "(unknown)",
			Status:        "not_found",
		}
	}

	match := ConvertMatch{
		OriginalTitle: title,
		OriginalYear:  year,
	}

	searchResult, err := client.SearchMovie(title, year)
	if err != nil || len(searchResult.Results) == 0 {
		if year != "" {
			searchResult, err = client.SearchMovie(title, "")
		}
		if err != nil || searchResult == nil || len(searchResult.Results) == 0 {
			match.Status = "not_found"
			return match
		}
	}

	maxResults := 5
	if len(searchResult.Results) < maxResults {
		maxResults = len(searchResult.Results)
	}
	match.Matches = searchResult.Results[:maxResults]

	if len(searchResult.Results) == 1 {
		match.BestMatch = &searchResult.Results[0]
		match.Status = "matched"
	} else {
		first := searchResult.Results[0]
		if strings.EqualFold(first.Title, title) && (year == "" || first.Year() == year) {
			match.BestMatch = &first
			match.Status = "matched"
		} else {
			match.BestMatch = &first
			match.Status = "multiple"
		}
	}

	return match
}

func sendSSE(w http.ResponseWriter, flusher http.Flusher, event string, data interface{}) {
	jsonBytes, _ := json.Marshal(data)
	fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, string(jsonBytes))
	flusher.Flush()
}

func ConvertTitlesStream(w http.ResponseWriter, r *http.Request) {
	var req ConvertRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}

	if len(req.Items) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "No items provided"})
		return
	}

	cfg, err := config.Get()
	if err != nil || config.SecretForUse(cfg.TMDbAPIKey) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "TMDb API key not configured"})
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Streaming not supported"})
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	client := tmdb.NewClient(config.SecretForUse(cfg.TMDbAPIKey))

	client.OnThrottle = func(wait time.Duration, reason string) {
		sendSSE(w, flusher, "throttle", map[string]interface{}{
			"wait_seconds": wait.Seconds(),
			"reason":       reason,
		})
	}

	total := len(req.Items)
	log.Printf("[convert] Starting stream conversion of %d items", total)

	sourceJSON, _ := json.Marshal(req.Items)

	session, err := conversions.CreateSession(req.FileName, total, string(sourceJSON))
	if err != nil {
		log.Printf("[convert] Failed to create session: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to create conversion session"})
		return
	}
	log.Printf("[convert] Created session %s for %q", session.ID, req.FileName)

	sendSSE(w, flusher, "progress", map[string]interface{}{
		"total":      total,
		"session_id": session.ID,
	})

	matched := 0
	for i, item := range req.Items {
		if r.Context().Err() != nil {
			log.Printf("[convert] Client disconnected at item %d/%d", i+1, total)
			conversions.UpdateSessionStatus(session.ID, "matching", matched)
			return
		}

		result := processItem(client, item)

		if result.Status == "matched" {
			matched++
		}

		selectedID := 0
		if result.BestMatch != nil {
			selectedID = result.BestMatch.ID
		}
		if err := conversions.AddItem(session.ID, i, result.OriginalTitle, result.OriginalYear, result.Status, result.Matches, selectedID); err != nil {
			log.Printf("[convert] Failed to persist item %d: %v", i, err)
		}

		// Periodically update session status so dashboard reflects progress
		if (i+1)%10 == 0 {
			conversions.UpdateSessionStatus(session.ID, "matching", matched)
		}

		matchInfo := "not_found"
		if result.BestMatch != nil {
			matchInfo = fmt.Sprintf("%s -> TMDb #%d %q", result.Status, result.BestMatch.ID, result.BestMatch.Title)
		}
		log.Printf("[convert] [%d/%d] %q (%s) %s", i+1, total, result.OriginalTitle, result.OriginalYear, matchInfo)

		sendSSE(w, flusher, "result", map[string]interface{}{
			"index": i,
			"match": result,
		})
	}

	conversions.UpdateSessionStatus(session.ID, "ready", matched)
	conversions.ClearSourceJSON(session.ID)
	log.Printf("[convert] Stream complete: %d/%d matched, session %s", matched, total, session.ID)

	sendSSE(w, flusher, "done", map[string]interface{}{
		"total":      total,
		"matched":    matched,
		"session_id": session.ID,
	})
}

func ResumeConvertStream(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "id")
	if sessionID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Session ID required"})
		return
	}

	session, err := conversions.GetSession(sessionID)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Session not found"})
		return
	}

	if session.Status != "matching" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Session is not in matching state"})
		return
	}

	sourceItems, err := conversions.GetSessionSourceData(sessionID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "No source data available for resume"})
		return
	}

	cfg, err := config.Get()
	if err != nil || config.SecretForUse(cfg.TMDbAPIKey) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "TMDb API key not configured"})
		return
	}

	matchedIndexes, err := conversions.GetMatchedIndexes(sessionID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to check existing items"})
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Streaming not supported"})
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	client := tmdb.NewClient(config.SecretForUse(cfg.TMDbAPIKey))
	client.OnThrottle = func(wait time.Duration, reason string) {
		sendSSE(w, flusher, "throttle", map[string]interface{}{
			"wait_seconds": wait.Seconds(),
			"reason":       reason,
		})
	}

	total := len(sourceItems)
	alreadyProcessed := len(matchedIndexes)
	log.Printf("[convert] Resuming session %s: %d/%d already processed", sessionID, alreadyProcessed, total)

	sendSSE(w, flusher, "progress", map[string]interface{}{
		"total":      total,
		"session_id": sessionID,
		"resumed":    alreadyProcessed,
	})

	matched := 0
	processed := alreadyProcessed
	for i, item := range sourceItems {
		if matchedIndexes[i] {
			continue
		}

		if r.Context().Err() != nil {
			log.Printf("[convert] Client disconnected during resume at item %d/%d", i+1, total)
			conversions.UpdateSessionStatus(sessionID, "matching", matched+alreadyProcessed)
			return
		}

		result := processItem(client, item)

		if result.Status == "matched" {
			matched++
		}
		processed++

		selectedID := 0
		if result.BestMatch != nil {
			selectedID = result.BestMatch.ID
		}
		if err := conversions.AddItem(sessionID, i, result.OriginalTitle, result.OriginalYear, result.Status, result.Matches, selectedID); err != nil {
			log.Printf("[convert] Failed to persist item %d: %v", i, err)
		}

		// Periodically update session status
		if processed%10 == 0 {
			conversions.UpdateSessionStatus(sessionID, "matching", matched+alreadyProcessed)
		}

		matchInfo := "not_found"
		if result.BestMatch != nil {
			matchInfo = fmt.Sprintf("%s -> TMDb #%d %q", result.Status, result.BestMatch.ID, result.BestMatch.Title)
		}
		log.Printf("[convert] [%d/%d] %q (%s) %s", processed, total, result.OriginalTitle, result.OriginalYear, matchInfo)

		sendSSE(w, flusher, "result", map[string]interface{}{
			"index": i,
			"match": result,
		})
	}

	totalMatched := matched + alreadyProcessed
	conversions.UpdateSessionStatus(sessionID, "ready", totalMatched)
	conversions.ClearSourceJSON(sessionID)
	log.Printf("[convert] Resume complete: %d new + %d prior matched, session %s", matched, alreadyProcessed, sessionID)

	sendSSE(w, flusher, "done", map[string]interface{}{
		"total":      total,
		"matched":    totalMatched,
		"session_id": sessionID,
	})
}

func extractString(item map[string]interface{}, keys ...string) string {
	for _, key := range keys {
		if val, ok := item[key]; ok {
			if s, ok := val.(string); ok && s != "" {
				return s
			}
		}
	}
	return ""
}

var yearRegex = regexp.MustCompile(`\b(19|20)\d{2}\b`)

func extractYear(item map[string]interface{}) string {
	for _, key := range []string{"year", "season", "release_year"} {
		if val, ok := item[key]; ok {
			switch v := val.(type) {
			case string:
				if matches := yearRegex.FindString(v); matches != "" {
					return matches
				}
			case float64:
				year := int(v)
				if year >= 1900 && year <= 2100 {
					return fmt.Sprintf("%d", year)
				}
			}
		}
	}

	for _, key := range []string{"air_date", "release_date", "date"} {
		if val, ok := item[key]; ok {
			if s, ok := val.(string); ok {
				if matches := yearRegex.FindString(s); matches != "" {
					return matches
				}
			}
		}
	}

	return ""
}
