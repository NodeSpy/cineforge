package handlers

import (
	"encoding/json"
	"net/http"

	"cineforge/internal/config"
	radarrClient "cineforge/internal/radarr"
)

func GetRadarrStatus(w http.ResponseWriter, r *http.Request) {
	cfg, err := config.Get()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to get config", err)
		return
	}

	client := radarrClient.NewClient(cfg.RadarrURL, config.SecretForUse(cfg.RadarrAPIKey))
	status, err := client.GetStatus()
	if err != nil {
		writeError(w, http.StatusBadGateway, "Failed to connect to Radarr", err)
		return
	}

	writeJSON(w, http.StatusOK, status)
}

type TestConnectionRequest struct {
	RadarrURL    string `json:"radarr_url"`
	RadarrAPIKey string `json:"radarr_api_key"`
}

func TestRadarrConnection(w http.ResponseWriter, r *http.Request) {
	var req TestConnectionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}

	if isMasked(req.RadarrAPIKey) {
		cfg, err := config.Get()
		if err != nil || config.SecretForUse(cfg.RadarrAPIKey) == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "No stored Radarr API key found"})
			return
		}
		req.RadarrAPIKey = config.SecretForUse(cfg.RadarrAPIKey)
	}

	if req.RadarrURL == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Radarr URL is required"})
		return
	}
	if err := validateServiceURL(req.RadarrURL); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid URL"})
		return
	}

	client := radarrClient.NewClient(req.RadarrURL, req.RadarrAPIKey)
	status, err := client.GetStatus()
	if err != nil {
		writeError(w, http.StatusOK, "Connection test failed", err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"version": status.Version,
		"appName": status.AppName,
	})
}

func GetQualityProfiles(w http.ResponseWriter, r *http.Request) {
	cfg, err := config.Get()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to get config"})
		return
	}

	client := radarrClient.NewClient(cfg.RadarrURL, config.SecretForUse(cfg.RadarrAPIKey))
	profiles, err := client.GetQualityProfiles()
	if err != nil {
		writeError(w, http.StatusBadGateway, "Failed to fetch quality profiles", err)
		return
	}

	writeJSON(w, http.StatusOK, profiles)
}

func GetRootFolders(w http.ResponseWriter, r *http.Request) {
	cfg, err := config.Get()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to get config", err)
		return
	}

	client := radarrClient.NewClient(cfg.RadarrURL, config.SecretForUse(cfg.RadarrAPIKey))
	folders, err := client.GetRootFolders()
	if err != nil {
		writeError(w, http.StatusBadGateway, "Failed to fetch root folders", err)
		return
	}

	writeJSON(w, http.StatusOK, folders)
}

func GetTags(w http.ResponseWriter, r *http.Request) {
	cfg, err := config.Get()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to get config"})
		return
	}

	client := radarrClient.NewClient(cfg.RadarrURL, config.SecretForUse(cfg.RadarrAPIKey))
	tags, err := client.GetTags()
	if err != nil {
		writeError(w, http.StatusBadGateway, "Failed to fetch tags", err)
		return
	}

	writeJSON(w, http.StatusOK, tags)
}

type CreateTagRequest struct {
	Label string `json:"label"`
}

func CreateTag(w http.ResponseWriter, r *http.Request) {
	var req CreateTagRequest
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
	tag, err := client.CreateTag(req.Label)
	if err != nil {
		writeError(w, http.StatusBadGateway, "Failed to create tag", err)
		return
	}

	writeJSON(w, http.StatusOK, tag)
}
