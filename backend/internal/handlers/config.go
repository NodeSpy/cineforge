package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"

	"cineforge/internal/config"
	radarrClient "cineforge/internal/radarr"
	"cineforge/internal/tmdb"
)

func GetConfig(w http.ResponseWriter, r *http.Request) {
	cfg, err := config.GetMasked()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to get config"})
		return
	}

	writeJSON(w, http.StatusOK, cfg)
}

func UpdateConfig(w http.ResponseWriter, r *http.Request) {
	var incoming map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&incoming); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}

	if len(incoming) == 0 {
		cfg, _ := config.GetMasked()
		writeJSON(w, http.StatusOK, cfg)
		return
	}

	fields := make(map[string]string)
	for key, val := range incoming {
		switch key {
		case "radarr_api_key", "tmdb_api_key":
			s, _ := val.(string)
			if s == "" || isMasked(s) {
				continue
			}
			fields[key] = s
		case "quality_profile_id":
			if n, ok := val.(float64); ok {
				fields[key] = fmt.Sprintf("%d", int(n))
			}
		case "search_on_add", "monitored":
			if b, ok := val.(bool); ok {
				fields[key] = fmt.Sprintf("%t", b)
			}
		default:
			if s, ok := val.(string); ok {
				fields[key] = s
			}
		}
	}

	if len(fields) > 0 {
		if err := config.SetFields(fields); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to save config"})
			return
		}
	}

	cfg, _ := config.GetMasked()
	writeJSON(w, http.StatusOK, cfg)
}

func GetSecrets(w http.ResponseWriter, r *http.Request) {
	cfg, err := config.Get()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to get config"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"radarr_api_key": cfg.RadarrAPIKey,
		"tmdb_api_key":   cfg.TMDbAPIKey,
	})
}

type ValidationResult struct {
	Service string `json:"service"`
	Status  string `json:"status"`
	Message string `json:"message"`
}

type ValidateConfigResponse struct {
	Results []ValidationResult `json:"results"`
}

func ValidateConfig(w http.ResponseWriter, r *http.Request) {
	cfg, err := config.Get()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to get config"})
		return
	}

	var results []ValidationResult

	// Test Radarr
	if cfg.RadarrURL != "" && cfg.RadarrAPIKey != "" {
		client := radarrClient.NewClient(cfg.RadarrURL, cfg.RadarrAPIKey)
		status, err := client.GetStatus()
		if err != nil {
			results = append(results, ValidationResult{
				Service: "Radarr",
				Status:  "error",
				Message: fmt.Sprintf("Connection failed: %v", err),
			})
		} else {
			results = append(results, ValidationResult{
				Service: "Radarr",
				Status:  "ok",
				Message: fmt.Sprintf("Connected to %s v%s", status.AppName, status.Version),
			})
		}
	} else {
		results = append(results, ValidationResult{
			Service: "Radarr",
			Status:  "warning",
			Message: "Radarr URL or API key not configured",
		})
	}

	// Test TMDb
	if cfg.TMDbAPIKey != "" {
		client := tmdb.NewClient(cfg.TMDbAPIKey)
		_, err := client.SearchMovie("test", "")
		if err != nil {
			results = append(results, ValidationResult{
				Service: "TMDb",
				Status:  "error",
				Message: fmt.Sprintf("Connection failed: %v", err),
			})
		} else {
			results = append(results, ValidationResult{
				Service: "TMDb",
				Status:  "ok",
				Message: "TMDb API connection successful",
			})
		}
	} else {
		results = append(results, ValidationResult{
			Service: "TMDb",
			Status:  "warning",
			Message: "TMDb API key not configured",
		})
	}

	writeJSON(w, http.StatusOK, ValidateConfigResponse{Results: results})
}
