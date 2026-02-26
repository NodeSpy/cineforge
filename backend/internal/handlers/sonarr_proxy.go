package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"cineforge/internal/config"
	"cineforge/internal/db"
	sonarrClient "cineforge/internal/sonarr"
)

func TestSonarrConnection(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SonarrURL    string `json:"sonarr_url"`
		SonarrAPIKey string `json:"sonarr_api_key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request"})
		return
	}

	client := sonarrClient.NewClient(req.SonarrURL, req.SonarrAPIKey)
	status, err := client.GetStatus()
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"version": status.Version,
		"appName": status.AppName,
	})
}

func GetSonarrQualityProfiles(w http.ResponseWriter, r *http.Request) {
	cfg, err := config.Get()
	if err != nil || cfg.SonarrURL == "" {
		writeJSON(w, http.StatusOK, []interface{}{})
		return
	}
	client := sonarrClient.NewClient(cfg.SonarrURL, cfg.SonarrAPIKey)
	profiles, err := client.GetQualityProfiles()
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, profiles)
}

func GetSonarrRootFolders(w http.ResponseWriter, r *http.Request) {
	cfg, err := config.Get()
	if err != nil || cfg.SonarrURL == "" {
		writeJSON(w, http.StatusOK, []interface{}{})
		return
	}
	client := sonarrClient.NewClient(cfg.SonarrURL, cfg.SonarrAPIKey)
	folders, err := client.GetRootFolders()
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, folders)
}

func GetSonarrTags(w http.ResponseWriter, r *http.Request) {
	cfg, err := config.Get()
	if err != nil || cfg.SonarrURL == "" {
		writeJSON(w, http.StatusOK, []interface{}{})
		return
	}
	client := sonarrClient.NewClient(cfg.SonarrURL, cfg.SonarrAPIKey)
	tags, err := client.GetTags()
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, tags)
}

func CreateSonarrTag(w http.ResponseWriter, r *http.Request) {
	cfg, err := config.Get()
	if err != nil || cfg.SonarrURL == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Sonarr not configured"})
		return
	}
	var req struct {
		Label string `json:"label"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request"})
		return
	}
	client := sonarrClient.NewClient(cfg.SonarrURL, cfg.SonarrAPIKey)
	tag, err := client.CreateTag(req.Label)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, tag)
}

type SonarrLibraryResponse struct {
	Series          []sonarrClient.Series          `json:"series"`
	Tags            []sonarrClient.Tag             `json:"tags"`
	QualityProfiles []sonarrClient.QualityProfile  `json:"quality_profiles"`
	FilterOptions   SonarrFilterOptions            `json:"filter_options"`
	CachedAt        string                         `json:"cached_at,omitempty"`
}

type SonarrFilterOptions struct {
	Genres      []string `json:"genres"`
	Networks    []string `json:"networks"`
	SeriesTypes []string `json:"series_types"`
	Years       YearRange `json:"years"`
}

func GetSonarrLibrary(w http.ResponseWriter, r *http.Request) {
	resp, err := loadCachedSonarrLibrary()
	if err == nil && len(resp.Series) > 0 {
		writeJSON(w, http.StatusOK, resp)
		return
	}
	resp, err = fetchAndCacheSonarrLibrary()
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func RefreshSonarrLibrary(w http.ResponseWriter, r *http.Request) {
	resp, err := fetchAndCacheSonarrLibrary()
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func fetchAndCacheSonarrLibrary() (*SonarrLibraryResponse, error) {
	cfg, err := config.Get()
	if err != nil {
		return nil, err
	}
	if cfg.SonarrURL == "" || cfg.SonarrAPIKey == "" {
		return &SonarrLibraryResponse{
			Series:          []sonarrClient.Series{},
			Tags:            []sonarrClient.Tag{},
			QualityProfiles: []sonarrClient.QualityProfile{},
			FilterOptions:   SonarrFilterOptions{},
		}, nil
	}
	client := sonarrClient.NewClient(cfg.SonarrURL, cfg.SonarrAPIKey)

	series, err := client.GetSeries()
	if err != nil {
		return nil, err
	}
	tags, _ := client.GetTags()
	profiles, _ := client.GetQualityProfiles()
	opts := buildSonarrFilterOptions(series)
	now := time.Now().UTC().Format(time.RFC3339)

	tx, err := db.DB.Begin()
	if err == nil {
		tx.Exec("DELETE FROM sonarr_library_cache")
		stmt, _ := tx.Prepare("INSERT INTO sonarr_library_cache (sonarr_id, data_json, updated_at) VALUES (?, ?, ?)")
		if stmt != nil {
			for _, s := range series {
				j, _ := json.Marshal(s)
				stmt.Exec(s.ID, string(j), now)
			}
			stmt.Close()
		}
		tagsJSON, _ := json.Marshal(tags)
		profilesJSON, _ := json.Marshal(profiles)
		tx.Exec("INSERT OR REPLACE INTO sonarr_library_cache_meta (key, value) VALUES ('tags', ?)", string(tagsJSON))
		tx.Exec("INSERT OR REPLACE INTO sonarr_library_cache_meta (key, value) VALUES ('profiles', ?)", string(profilesJSON))
		tx.Exec("INSERT OR REPLACE INTO sonarr_library_cache_meta (key, value) VALUES ('last_refreshed', ?)", now)
		tx.Commit()
	}

	return &SonarrLibraryResponse{
		Series:          series,
		Tags:            tags,
		QualityProfiles: profiles,
		FilterOptions:   opts,
		CachedAt:        now,
	}, nil
}

func loadCachedSonarrLibrary() (*SonarrLibraryResponse, error) {
	var cachedAt string
	err := db.DB.QueryRow("SELECT value FROM sonarr_library_cache_meta WHERE key='last_refreshed'").Scan(&cachedAt)
	if err != nil {
		return nil, err
	}

	rows, err := db.DB.Query("SELECT data_json FROM sonarr_library_cache ORDER BY sonarr_id")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var series []sonarrClient.Series
	for rows.Next() {
		var j string
		if err := rows.Scan(&j); err != nil {
			continue
		}
		var s sonarrClient.Series
		if err := json.Unmarshal([]byte(j), &s); err != nil {
			continue
		}
		series = append(series, s)
	}

	if len(series) == 0 {
		return nil, err
	}

	var tags []sonarrClient.Tag
	var profiles []sonarrClient.QualityProfile

	var tagsJSON, profilesJSON string
	if db.DB.QueryRow("SELECT value FROM sonarr_library_cache_meta WHERE key='tags'").Scan(&tagsJSON) == nil {
		json.Unmarshal([]byte(tagsJSON), &tags)
	}
	if db.DB.QueryRow("SELECT value FROM sonarr_library_cache_meta WHERE key='profiles'").Scan(&profilesJSON) == nil {
		json.Unmarshal([]byte(profilesJSON), &profiles)
	}

	return &SonarrLibraryResponse{
		Series:          series,
		Tags:            tags,
		QualityProfiles: profiles,
		FilterOptions:   buildSonarrFilterOptions(series),
		CachedAt:        cachedAt,
	}, nil
}

type SeriesDetailResponse struct {
	Series   sonarrClient.Series       `json:"series"`
	Episodes []sonarrClient.Episode    `json:"episodes"`
	Files    []sonarrClient.EpisodeFile `json:"files"`
}

func GetSonarrSeriesDetail(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid series ID"})
		return
	}

	cfg, err := config.Get()
	if err != nil || cfg.SonarrURL == "" || cfg.SonarrAPIKey == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Sonarr not configured"})
		return
	}

	client := sonarrClient.NewClient(cfg.SonarrURL, cfg.SonarrAPIKey)

	s, err := client.GetSeriesByID(id)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}

	episodes, err := client.GetEpisodes(id)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}

	files, err := client.GetEpisodeFiles(id)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, SeriesDetailResponse{
		Series:   *s,
		Episodes: episodes,
		Files:    files,
	})
}

func buildSonarrFilterOptions(series []sonarrClient.Series) SonarrFilterOptions {
	gen := make(map[string]bool)
	net := make(map[string]bool)
	st := make(map[string]bool)
	minY, maxY := 9999, 0
	for _, s := range series {
		for _, g := range s.Genres {
			gen[g] = true
		}
		if s.Network != "" {
			net[s.Network] = true
		}
		if s.SeriesType != "" {
			st[s.SeriesType] = true
		}
		if s.Year > 0 {
			if s.Year < minY {
				minY = s.Year
			}
			if s.Year > maxY {
				maxY = s.Year
			}
		}
	}
	if minY == 9999 {
		minY = 1900
	}
	if maxY == 0 {
		maxY = 2026
	}
	return SonarrFilterOptions{
		Genres:      strSetToSlice(gen),
		Networks:    strSetToSlice(net),
		SeriesTypes: strSetToSlice(st),
		Years:       YearRange{Min: minY, Max: maxY},
	}
}
