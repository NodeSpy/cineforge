package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"radarr-importer/internal/conversions"
)

func ListConversions(w http.ResponseWriter, r *http.Request) {
	sessions, err := conversions.ListSessions()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to list sessions"})
		return
	}

	writeJSON(w, http.StatusOK, sessions)
}

func GetConversion(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Session ID required"})
		return
	}

	session, err := conversions.GetSession(id)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Session not found"})
		return
	}

	writeJSON(w, http.StatusOK, session)
}

type UpdateSelectionRequest struct {
	ItemIndex int `json:"item_index"`
	TmdbID    int `json:"tmdb_id"`
}

func UpdateConversionSelection(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Session ID required"})
		return
	}

	var req UpdateSelectionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}

	if err := conversions.UpdateSelection(id, req.ItemIndex, req.TmdbID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to update selection"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func DeleteConversion(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Session ID required"})
		return
	}

	if err := conversions.DeleteSession(id); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to delete session"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
