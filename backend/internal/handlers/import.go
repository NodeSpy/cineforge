package handlers

import (
	"encoding/json"
	"log"
	"net/http"

	"cineforge/internal/config"
	"cineforge/internal/conversions"
	"cineforge/internal/db"
	"cineforge/internal/jobs"
	radarrClient "cineforge/internal/radarr"
)

type ImportItem struct {
	TmdbID int    `json:"tmdb_id"`
	ImdbID string `json:"imdb_id"`
	Title  string `json:"title"`
}

type ImportRequest struct {
	Items     []ImportItem `json:"items"`
	SessionID string       `json:"session_id,omitempty"`
	Tags      []int        `json:"tags,omitempty"`
}

type PreviewItem struct {
	TmdbID    int    `json:"tmdb_id"`
	ImdbID    string `json:"imdb_id"`
	Title     string `json:"title"`
	Year      int    `json:"year"`
	Overview  string `json:"overview"`
	PosterURL string `json:"poster_url"`
	Status    string `json:"status"` // "ready", "exists", "not_found", "error"
	Error     string `json:"error,omitempty"`
}

type PreviewResponse struct {
	Items []PreviewItem `json:"items"`
	Total int           `json:"total"`
	Ready int           `json:"ready"`
}

func PreviewImport(w http.ResponseWriter, r *http.Request) {
	var req ImportRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}

	cfg, err := config.Get()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to get config"})
		return
	}

	client := radarrClient.NewClient(cfg.RadarrURL, config.SecretForUse(cfg.RadarrAPIKey))

	existingMovies, _ := client.GetMovies()
	existingTmdbIDs := make(map[int]bool)
	for _, m := range existingMovies {
		existingTmdbIDs[m.TmdbID] = true
	}

	items := make([]PreviewItem, 0, len(req.Items))
	ready := 0

	for _, item := range req.Items {
		preview := PreviewItem{
			TmdbID: item.TmdbID,
			ImdbID: item.ImdbID,
		}

		var movie *radarrClient.Movie
		var lookupErr error

		if item.TmdbID > 0 {
			movie, lookupErr = client.LookupByTmdbID(item.TmdbID)
		} else if item.ImdbID != "" {
			movie, lookupErr = client.LookupByImdbID(item.ImdbID)
		} else {
			preview.Title = item.Title
			preview.Status = "error"
			preview.Error = "No TMDb or IMDb ID provided"
			items = append(items, preview)
			continue
		}

		if lookupErr != nil {
			preview.Title = item.Title
			preview.Status = "not_found"
			preview.Error = lookupErr.Error()
			items = append(items, preview)
			continue
		}

		preview.TmdbID = movie.TmdbID
		preview.ImdbID = movie.ImdbID
		preview.Title = movie.Title
		preview.Year = movie.Year
		preview.Overview = movie.Overview

		for _, img := range movie.Images {
			if img.CoverType == "poster" && img.RemoteURL != "" {
				preview.PosterURL = img.RemoteURL
				break
			}
		}

		if existingTmdbIDs[movie.TmdbID] {
			preview.Status = "exists"
		} else {
			preview.Status = "ready"
			ready++
		}

		items = append(items, preview)
	}

	writeJSON(w, http.StatusOK, PreviewResponse{
		Items: items,
		Total: len(items),
		Ready: ready,
	})
}

type ImportResponse struct {
	JobID string `json:"job_id"`
}

func ImportMovies(w http.ResponseWriter, r *http.Request) {
	var req ImportRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}

	if len(req.Items) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "No items to import"})
		return
	}

	cfg, err := config.Get()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to get config"})
		return
	}

	if cfg.QualityProfileID <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "Quality Profile is not configured. Please select one in Settings.",
		})
		return
	}
	if cfg.RootFolderPath == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "Root Folder is not configured. Please select one in Settings.",
		})
		return
	}

	if req.SessionID != "" {
		conversions.SetSessionStatus(req.SessionID, "importing")
	}

	job := jobs.Create("import", len(req.Items))

	if req.SessionID != "" {
		conversions.SetSessionJobID(req.SessionID, job.ID)
	}

	go runImport(job, cfg, req.Items, req.SessionID, req.Tags)

	writeJSON(w, http.StatusAccepted, ImportResponse{JobID: job.ID})
}

func runImport(job *jobs.Job, cfg config.AppConfig, items []ImportItem, sessionID string, tags []int) {
	job.Start()
	client := radarrClient.NewClient(cfg.RadarrURL, config.SecretForUse(cfg.RadarrAPIKey))

	existingTmdbIDs := make(map[int]bool)
	existingImdbIDs := make(map[string]bool)
	if existing, err := client.GetMovies(); err == nil {
		for _, m := range existing {
			if m.TmdbID > 0 {
				existingTmdbIDs[m.TmdbID] = true
			}
			if m.ImdbID != "" {
				existingImdbIDs[m.ImdbID] = true
			}
		}
		log.Printf("[import] Loaded %d existing movies from Radarr", len(existing))
	} else {
		log.Printf("[import] Warning: could not fetch existing movies from Radarr: %v", err)
	}

	for _, item := range items {
		if item.TmdbID > 0 && existingTmdbIDs[item.TmdbID] {
			log.Printf("[import] Skipping %q (TMDb #%d) — already in Radarr", item.Title, item.TmdbID)
			job.AddResult(jobs.Result{
				Title:  item.Title,
				TmdbID: item.TmdbID,
				ImdbID: item.ImdbID,
				Status: "skipped",
				Error:  "Already in Radarr",
			})
			if sessionID != "" {
				conversions.MarkItemImported(sessionID, item.TmdbID)
			}
			continue
		}
		if item.ImdbID != "" && existingImdbIDs[item.ImdbID] {
			log.Printf("[import] Skipping %q (IMDb %s) — already in Radarr", item.Title, item.ImdbID)
			job.AddResult(jobs.Result{
				Title:  item.Title,
				TmdbID: item.TmdbID,
				ImdbID: item.ImdbID,
				Status: "skipped",
				Error:  "Already in Radarr",
			})
			if sessionID != "" && item.TmdbID > 0 {
				conversions.MarkItemImported(sessionID, item.TmdbID)
			}
			continue
		}

		var movie *radarrClient.Movie
		var err error

		if item.TmdbID > 0 {
			movie, err = client.LookupByTmdbID(item.TmdbID)
		} else if item.ImdbID != "" {
			movie, err = client.LookupByImdbID(item.ImdbID)
		} else {
			job.AddResult(jobs.Result{
				Title:  item.Title,
				Status: "failed",
				Error:  "No TMDb or IMDb ID",
			})
			continue
		}

		if err != nil {
			job.AddResult(jobs.Result{
				Title:  item.Title,
				TmdbID: item.TmdbID,
				ImdbID: item.ImdbID,
				Status: "failed",
				Error:  err.Error(),
			})
			continue
		}

		movie.Monitored = cfg.Monitored
		movie.QualityProfileID = cfg.QualityProfileID
		movie.RootFolderPath = cfg.RootFolderPath
		movie.MinimumAvailability = cfg.MinAvailability
		movie.AddOptions = &radarrClient.AddOptions{
			SearchForMovie: cfg.SearchOnAdd,
		}
		if len(tags) > 0 {
			movie.Tags = tags
		}

		added, err := client.AddMovie(*movie)
		if err != nil {
			job.AddResult(jobs.Result{
				Title:  movie.Title,
				TmdbID: movie.TmdbID,
				ImdbID: movie.ImdbID,
				Status: "failed",
				Error:  err.Error(),
			})
			continue
		}

		job.AddResult(jobs.Result{
			Title:  added.Title,
			TmdbID: added.TmdbID,
			ImdbID: added.ImdbID,
			Status: "success",
		})

		db.DB.Exec(`INSERT OR IGNORE INTO imported_movies (tmdb_id, imdb_id, title, job_id) VALUES (?, ?, ?, ?)`,
			added.TmdbID, added.ImdbID, added.Title, job.ID)

		if sessionID != "" {
			if err := conversions.MarkItemImported(sessionID, added.TmdbID); err != nil {
				log.Printf("[import] Failed to mark item imported in session %s: %v", sessionID, err)
			}
		}
	}

	job.Complete()

	if sessionID != "" {
		if err := conversions.DeleteImportedItems(sessionID); err != nil {
			log.Printf("[import] Failed to clean up imported items for session %s: %v", sessionID, err)
		} else {
			log.Printf("[import] Cleaned up imported items for session %s", sessionID)
		}
		conversions.SetSessionStatus(sessionID, "done")
	}
}
