package handlers

import (
	"encoding/json"
	"net/http"

	"radarr-importer/internal/config"
	"radarr-importer/internal/tmdb"
)

type TestTMDbRequest struct {
	APIKey string `json:"api_key"`
}

func TestTMDbConnection(w http.ResponseWriter, r *http.Request) {
	var req TestTMDbRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}

	if isMasked(req.APIKey) {
		cfg, err := config.Get()
		if err != nil || cfg.TMDbAPIKey == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "No stored TMDb API key found"})
			return
		}
		req.APIKey = cfg.TMDbAPIKey
	}

	if req.APIKey == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "TMDb API key is required"})
		return
	}

	client := tmdb.NewClient(req.APIKey)
	result, err := client.SearchMovie("test", "")
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success":       true,
		"total_results": result.TotalResults,
	})
}
