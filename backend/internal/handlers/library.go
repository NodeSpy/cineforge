package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"cineforge/internal/config"
	"cineforge/internal/db"
	radarrClient "cineforge/internal/radarr"
)

type LibraryResponse struct {
	Movies          []radarrClient.Movie          `json:"movies"`
	Tags            []radarrClient.Tag            `json:"tags"`
	QualityProfiles []radarrClient.QualityProfile `json:"quality_profiles"`
	FilterOptions   FilterOptions                 `json:"filter_options"`
	NormalizedIDs   []int                         `json:"normalized_ids"`
	CachedAt        string                        `json:"cached_at,omitempty"`
}

type FilterOptions struct {
	VideoCodecs []string  `json:"video_codecs"`
	AudioCodecs []string  `json:"audio_codecs"`
	Resolutions []int     `json:"resolutions"`
	Genres      []string  `json:"genres"`
	RootFolders []string  `json:"root_folders"`
	Years       YearRange `json:"years"`
}

type YearRange struct {
	Min int `json:"min"`
	Max int `json:"max"`
}

func GetLibrary(w http.ResponseWriter, r *http.Request) {
	resp, err := loadCachedLibrary()
	if err == nil && len(resp.Movies) > 0 {
		writeJSON(w, http.StatusOK, resp)
		return
	}

	resp, err = fetchAndCacheLibrary()
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func RefreshLibrary(w http.ResponseWriter, r *http.Request) {
	resp, err := fetchAndCacheLibrary()
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func fetchAndCacheLibrary() (*LibraryResponse, error) {
	cfg, err := config.Get()
	if err != nil {
		return nil, err
	}
	client := radarrClient.NewClient(cfg.RadarrURL, config.SecretForUse(cfg.RadarrAPIKey))

	movies, err := client.GetMovies()
	if err != nil {
		return nil, err
	}

	tags, _ := client.GetTags()
	profiles, _ := client.GetQualityProfiles()
	opts := buildFilterOptions(movies)
	now := time.Now().UTC().Format(time.RFC3339)

	tx, err := db.DB.Begin()
	if err == nil {
		tx.Exec("DELETE FROM library_cache")
		stmt, _ := tx.Prepare("INSERT INTO library_cache (radarr_id, data_json, updated_at) VALUES (?, ?, ?)")
		if stmt != nil {
			for _, m := range movies {
				j, _ := json.Marshal(m)
				stmt.Exec(m.ID, string(j), now)
			}
			stmt.Close()
		}

		tagsJSON, _ := json.Marshal(tags)
		profilesJSON, _ := json.Marshal(profiles)
		tx.Exec("INSERT OR REPLACE INTO library_cache_meta (key, value) VALUES ('tags', ?)", string(tagsJSON))
		tx.Exec("INSERT OR REPLACE INTO library_cache_meta (key, value) VALUES ('profiles', ?)", string(profilesJSON))
		tx.Exec("INSERT OR REPLACE INTO library_cache_meta (key, value) VALUES ('last_refreshed', ?)", now)
		tx.Commit()
	}

	return &LibraryResponse{
		Movies:          movies,
		Tags:            tags,
		QualityProfiles: profiles,
		FilterOptions:   opts,
		NormalizedIDs:   getNormalizedIDs(movies),
		CachedAt:        now,
	}, nil
}

func loadCachedLibrary() (*LibraryResponse, error) {
	var cachedAt string
	err := db.DB.QueryRow("SELECT value FROM library_cache_meta WHERE key='last_refreshed'").Scan(&cachedAt)
	if err != nil {
		return nil, err
	}

	rows, err := db.DB.Query("SELECT data_json FROM library_cache ORDER BY radarr_id")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var movies []radarrClient.Movie
	for rows.Next() {
		var j string
		if err := rows.Scan(&j); err != nil {
			continue
		}
		var m radarrClient.Movie
		if err := json.Unmarshal([]byte(j), &m); err != nil {
			continue
		}
		movies = append(movies, m)
	}

	if len(movies) == 0 {
		return nil, err
	}

	var tags []radarrClient.Tag
	var profiles []radarrClient.QualityProfile

	var tagsJSON, profilesJSON string
	if db.DB.QueryRow("SELECT value FROM library_cache_meta WHERE key='tags'").Scan(&tagsJSON) == nil {
		json.Unmarshal([]byte(tagsJSON), &tags)
	}
	if db.DB.QueryRow("SELECT value FROM library_cache_meta WHERE key='profiles'").Scan(&profilesJSON) == nil {
		json.Unmarshal([]byte(profilesJSON), &profiles)
	}

	return &LibraryResponse{
		Movies:          movies,
		Tags:            tags,
		QualityProfiles: profiles,
		FilterOptions:   buildFilterOptions(movies),
		NormalizedIDs:   getNormalizedIDs(movies),
		CachedAt:        cachedAt,
	}, nil
}

func buildFilterOptions(movies []radarrClient.Movie) FilterOptions {
	vc := make(map[string]bool)
	ac := make(map[string]bool)
	res := make(map[int]bool)
	gen := make(map[string]bool)
	rf := make(map[string]bool)
	minY, maxY := 9999, 0
	for _, m := range movies {
		for _, g := range m.Genres {
			gen[g] = true
		}
		if m.RootFolderPath != "" {
			rf[m.RootFolderPath] = true
		}
		if m.Year > 0 {
			if m.Year < minY {
				minY = m.Year
			}
			if m.Year > maxY {
				maxY = m.Year
			}
		}
		if m.MovieFile != nil && m.MovieFile.MediaInfo != nil {
			mi := m.MovieFile.MediaInfo
			if mi.VideoCodec != "" {
				vc[mi.VideoCodec] = true
			}
			if mi.AudioCodec != "" {
				ac[mi.AudioCodec] = true
			}
		}
		if m.MovieFile != nil && m.MovieFile.Quality != nil {
			r := m.MovieFile.Quality.Quality.Resolution
			if r > 0 {
				res[r] = true
			}
		}
	}
	if minY == 9999 {
		minY = 1900
	}
	if maxY == 0 {
		maxY = 2026
	}
	return FilterOptions{
		VideoCodecs: strSetToSlice(vc),
		AudioCodecs: strSetToSlice(ac),
		Resolutions: intSetToSlice(res),
		Genres:      strSetToSlice(gen),
		RootFolders: strSetToSlice(rf),
		Years:       YearRange{Min: minY, Max: maxY},
	}
}

func getNormalizedIDs(movies []radarrClient.Movie) []int {
	rows, err := db.DB.Query("SELECT DISTINCT file_path FROM normalize_history")
	if err != nil {
		return []int{}
	}
	defer rows.Close()

	normalizedPaths := make(map[string]bool)
	for rows.Next() {
		var fp string
		if rows.Scan(&fp) == nil {
			normalizedPaths[fp] = true
		}
	}

	var ids []int
	for _, m := range movies {
		if m.MovieFile != nil && m.MovieFile.Path != "" && normalizedPaths[m.MovieFile.Path] {
			ids = append(ids, m.ID)
		}
	}
	if ids == nil {
		ids = []int{}
	}
	return ids
}

func strSetToSlice(m map[string]bool) []string {
	s := make([]string, 0, len(m))
	for k := range m {
		s = append(s, k)
	}
	return s
}

func intSetToSlice(m map[int]bool) []int {
	s := make([]int, 0, len(m))
	for k := range m {
		s = append(s, k)
	}
	return s
}
