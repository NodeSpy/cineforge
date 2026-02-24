package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"cineforge/internal/config"
	"cineforge/internal/db"
	"cineforge/internal/jobs"
	radarrClient "cineforge/internal/radarr"
)

func GetJob(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Job ID required"})
		return
	}

	job := jobs.Get(id)
	if job == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Job not found"})
		return
	}

	writeJSON(w, http.StatusOK, job)
}

func GetRecentJobs(w http.ResponseWriter, r *http.Request) {
	recent := jobs.GetRecent(20)
	writeJSON(w, http.StatusOK, recent)
}

type ReconciledResult struct {
	Title         string `json:"title"`
	TmdbID        int    `json:"tmdb_id,omitempty"`
	ImdbID        string `json:"imdb_id,omitempty"`
	Status        string `json:"status"`
	Error         string `json:"error,omitempty"`
	CurrentStatus string `json:"current_status"`
}

type ReconcileResponse struct {
	Results []ReconciledResult `json:"results"`
	Summary struct {
		InRadarr int `json:"in_radarr"`
		Missing  int `json:"missing"`
	} `json:"summary"`
}

func ReconcileJob(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Job ID required"})
		return
	}

	job := jobs.Get(id)
	if job == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Job not found"})
		return
	}

	cfg, err := config.Get()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to get config"})
		return
	}

	client := radarrClient.NewClient(cfg.RadarrURL, cfg.RadarrAPIKey)
	movies, err := client.GetMovies()
	if err != nil {
		log.Printf("[reconcile] Failed to fetch Radarr movies: %v", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Failed to fetch movies from Radarr"})
		return
	}

	tmdbSet := make(map[int]bool, len(movies))
	imdbSet := make(map[string]bool, len(movies))
	for _, m := range movies {
		if m.TmdbID > 0 {
			tmdbSet[m.TmdbID] = true
		}
		if m.ImdbID != "" {
			imdbSet[m.ImdbID] = true
		}
	}

	resp := ReconcileResponse{
		Results: make([]ReconciledResult, 0, len(job.Results)),
	}

	for _, result := range job.Results {
		rr := ReconciledResult{
			Title:  result.Title,
			TmdbID: result.TmdbID,
			ImdbID: result.ImdbID,
			Status: result.Status,
			Error:  result.Error,
		}

		inRadarr := (result.TmdbID > 0 && tmdbSet[result.TmdbID]) ||
			(result.ImdbID != "" && imdbSet[result.ImdbID])

		if inRadarr {
			rr.CurrentStatus = "in_radarr"
			resp.Summary.InRadarr++
		} else {
			rr.CurrentStatus = "missing"
			resp.Summary.Missing++
		}

		resp.Results = append(resp.Results, rr)
	}

	resultsJSON, _ := json.Marshal(resp)
	db.DB.Exec("UPDATE jobs SET reconciled_results=?, reconciled_at=? WHERE id=?",
		string(resultsJSON), time.Now().Format(time.RFC3339), id)

	writeJSON(w, http.StatusOK, resp)
}
