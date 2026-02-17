package handlers

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"radarr-importer/internal/jobs"
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
