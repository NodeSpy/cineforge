package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"cineforge/internal/config"
	"cineforge/internal/db"
	"cineforge/internal/normalize"
	radarrClient "cineforge/internal/radarr"
	sonarrClient "cineforge/internal/sonarr"
)

var activeSSEConnections atomic.Int32

const maxSSEConnections = 20

type NormalizeCandidate struct {
	Title      string `json:"title"`
	Year       int    `json:"year"`
	TmdbID     int    `json:"tmdb_id"`
	RadarrID   int    `json:"radarr_id"`
	FilePath   string `json:"file_path"`
	FileSize   int64  `json:"file_size"`
	PosterURL  string `json:"poster_url"`
	Normalized bool   `json:"already_normalized"`
}

type NormalizeStartRequest struct {
	Items  []NormalizeStartItem       `json:"items"`
	Config *normalize.NormalizeConfig  `json:"config,omitempty"`
}

type NormalizeStartItem struct {
	RadarrID   int      `json:"radarr_id"`
	TmdbID     int      `json:"tmdb_id"`
	Title      string   `json:"title"`
	FilePath   string   `json:"file_path"`
	TargetLUFS *float64 `json:"target_lufs,omitempty"`
}

type NormalizeJobResponse struct {
	ID        string `json:"id"`
	Status    string `json:"status"`
	Total     int    `json:"total"`
	Completed int    `json:"completed"`
	Succeeded int    `json:"succeeded"`
	Failed    int    `json:"failed"`
	Skipped   int    `json:"skipped"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

type NormalizeJobDetailResponse struct {
	NormalizeJobResponse
	Items []NormalizeJobItem `json:"items"`
}

type NormalizeJobItem struct {
	FilePath     string   `json:"file_path"`
	Title        string   `json:"title"`
	Status       string   `json:"status"`
	MeasuredLUFS *float64 `json:"measured_lufs,omitempty"`
	TargetLUFS   *float64 `json:"target_lufs,omitempty"`
	Error        string   `json:"error,omitempty"`
}

type PaginatedNormalizeJobsResponse struct {
	Jobs    []NormalizeJobResponse `json:"jobs"`
	Total   int                   `json:"total"`
	Page    int                   `json:"page"`
	PerPage int                   `json:"per_page"`
}

var (
	activeNormalizeJobs   = make(map[string]chan struct{})
	activeNormalizeJobsMu sync.Mutex
)

func GetNormalizeCandidates(w http.ResponseWriter, r *http.Request) {
	cfg, err := config.Get()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to get config"})
		return
	}
	client := radarrClient.NewClient(cfg.RadarrURL, cfg.RadarrAPIKey)
	movies, err := client.GetMovies()
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Failed to fetch movies: " + err.Error()})
		return
	}
	rows, err := db.DB.Query("SELECT DISTINCT tmdb_id FROM imported_movies")
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to query imported movies"})
		return
	}
	defer rows.Close()
	importedIDs := make(map[int]bool)
	for rows.Next() {
		var id int
		rows.Scan(&id)
		importedIDs[id] = true
	}
	ncfg := config.GetNormalizeConfig()
	var candidates []NormalizeCandidate
	for _, m := range movies {
		if !importedIDs[m.TmdbID] || !m.HasFile || m.MovieFile == nil {
			continue
		}
		filePath := m.MovieFile.Path
		if filePath == "" {
			continue
		}
		normalized := false
		if fi, err := os.Stat(filePath); err == nil {
			var count int
			db.DB.QueryRow(
				"SELECT COUNT(*) FROM normalize_history WHERE file_path=? AND file_size=? AND file_mtime=? AND target_lufs=?",
				filePath, fi.Size(), fi.ModTime().Unix(), ncfg.TargetLUFS,
			).Scan(&count)
			normalized = count > 0
		}
		posterURL := ""
		for _, img := range m.Images {
			if img.CoverType == "poster" && img.RemoteURL != "" {
				posterURL = img.RemoteURL
				break
			}
		}
		candidates = append(candidates, NormalizeCandidate{
			Title: m.Title, Year: m.Year, TmdbID: m.TmdbID, RadarrID: m.ID,
			FilePath: filePath, FileSize: m.MovieFile.Size, PosterURL: posterURL, Normalized: normalized,
		})
	}
	if candidates == nil {
		candidates = []NormalizeCandidate{}
	}
	writeJSON(w, http.StatusOK, candidates)
}

func GetSonarrNormalizeCandidates(w http.ResponseWriter, r *http.Request) {
	cfg, err := config.Get()
	if err != nil || cfg.SonarrURL == "" || cfg.SonarrAPIKey == "" {
		writeJSON(w, http.StatusOK, []NormalizeCandidate{})
		return
	}
	client := sonarrClient.NewClient(cfg.SonarrURL, cfg.SonarrAPIKey)
	seriesList, err := client.GetSeries()
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Failed to fetch series: " + err.Error()})
		return
	}

	idsParam := r.URL.Query().Get("ids")
	idFilter := make(map[int]bool)
	if idsParam != "" {
		for _, s := range splitCSV(idsParam) {
			if id, err := strconv.Atoi(s); err == nil {
				idFilter[id] = true
			}
		}
	}

	ncfg := config.GetNormalizeConfig()
	var candidates []NormalizeCandidate
	for _, s := range seriesList {
		if len(idFilter) > 0 && !idFilter[s.ID] {
			continue
		}
		files, err := client.GetEpisodeFiles(s.ID)
		if err != nil {
			continue
		}
		posterURL := ""
		for _, img := range s.Images {
			if img.CoverType == "poster" && img.RemoteURL != "" {
				posterURL = img.RemoteURL
				break
			}
		}
		for _, f := range files {
			if f.Path == "" {
				continue
			}
			normalized := false
			if fi, err := os.Stat(f.Path); err == nil {
				var count int
				db.DB.QueryRow(
					"SELECT COUNT(*) FROM normalize_history WHERE file_path=? AND file_size=? AND file_mtime=? AND target_lufs=?",
					f.Path, fi.Size(), fi.ModTime().Unix(), ncfg.TargetLUFS,
				).Scan(&count)
				normalized = count > 0
			}
			title := fmt.Sprintf("%s - S%02dE%02d", s.Title, f.SeasonNumber, 0)
			if f.RelativePath != "" {
				title = fmt.Sprintf("%s - %s", s.Title, f.RelativePath)
			}
			candidates = append(candidates, NormalizeCandidate{
				Title: title, Year: s.Year, TmdbID: 0, RadarrID: s.ID,
				FilePath: f.Path, FileSize: f.Size, PosterURL: posterURL, Normalized: normalized,
			})
		}
	}
	if candidates == nil {
		candidates = []NormalizeCandidate{}
	}
	writeJSON(w, http.StatusOK, candidates)
}

func splitCSV(s string) []string {
	var parts []string
	for _, p := range strings.Split(s, ",") {
		p = strings.TrimSpace(p)
		if p != "" {
			parts = append(parts, p)
		}
	}
	return parts
}

func getAllowedMediaRoots() []string {
	cfg, err := config.Get()
	if err != nil {
		return nil
	}
	var roots []string
	if cfg.RootFolderPath != "" {
		roots = append(roots, filepath.Clean(cfg.RootFolderPath))
	}
	if cfg.SonarrURL != "" {
		rows, err := db.DB.Query("SELECT value FROM config WHERE key='sonarr_root_folder_path'")
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var v string
				if rows.Scan(&v) == nil && v != "" {
					roots = append(roots, filepath.Clean(v))
				}
			}
		}
	}
	mediaEnv := os.Getenv("MEDIA_ROOT")
	if mediaEnv != "" {
		for _, p := range strings.Split(mediaEnv, ":") {
			if p != "" {
				roots = append(roots, filepath.Clean(p))
			}
		}
	}
	if len(roots) == 0 {
		roots = append(roots, "/media")
	}
	return roots
}

func isPathAllowed(filePath string, allowedRoots []string) bool {
	cleaned := filepath.Clean(filePath)
	if !filepath.IsAbs(cleaned) {
		return false
	}
	for _, root := range allowedRoots {
		if strings.HasPrefix(cleaned, root+"/") || cleaned == root {
			return true
		}
	}
	return false
}

func StartNormalize(w http.ResponseWriter, r *http.Request) {
	var req NormalizeStartRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}
	if len(req.Items) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "No items to normalize"})
		return
	}
	if len(req.Items) > 10000 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Too many items (max 10000)"})
		return
	}

	allowedRoots := getAllowedMediaRoots()
	for _, item := range req.Items {
		if !isPathAllowed(item.FilePath, allowedRoots) {
			writeJSON(w, http.StatusBadRequest, map[string]string{
				"error": fmt.Sprintf("File path %q is not under an allowed media root", item.FilePath),
			})
			return
		}
	}
	ncfg := normalize.DefaultConfig()
	if req.Config != nil {
		ncfg = *req.Config
	} else {
		cfgDB := config.GetNormalizeConfig()
		ncfg = normalize.NormalizeConfig{
			TargetLUFS: cfgDB.TargetLUFS, HWAccel: cfgDB.HWAccel, AudioBitrate: cfgDB.AudioBitrate,
			Backup: cfgDB.Backup, Parallel: cfgDB.Parallel, VideoMode: cfgDB.VideoMode,
			MeasureMode: cfgDB.MeasureMode,
		}
	}
	jobID := uuid.New().String()
	cfgJSON, _ := json.Marshal(ncfg)
	now := time.Now().Format(time.RFC3339)
	db.DB.Exec(`INSERT INTO normalize_jobs (id, status, total, config_snapshot, created_at, updated_at) VALUES (?, 'pending', ?, ?, ?, ?)`,
		jobID, len(req.Items), string(cfgJSON), now, now)
	for i, item := range req.Items {
		itemLUFS := ncfg.TargetLUFS
		if item.TargetLUFS != nil {
			itemLUFS = *item.TargetLUFS
		}
		db.DB.Exec(`INSERT INTO normalize_items (job_id, item_index, file_path, movie_title, radarr_movie_id, tmdb_id, status, target_lufs) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
			jobID, i, item.FilePath, item.Title, item.RadarrID, item.TmdbID, itemLUFS)
	}
	stopCh := make(chan struct{})
	activeNormalizeJobsMu.Lock()
	activeNormalizeJobs[jobID] = stopCh
	activeNormalizeJobsMu.Unlock()
	go runNormalizeJob(jobID, req.Items, ncfg, stopCh)
	writeJSON(w, http.StatusAccepted, map[string]string{"job_id": jobID})
}

func runNormalizeJob(jobID string, items []NormalizeStartItem, cfg normalize.NormalizeConfig, stopCh chan struct{}) {
	defer func() {
		activeNormalizeJobsMu.Lock()
		delete(activeNormalizeJobs, jobID)
		activeNormalizeJobsMu.Unlock()
	}()

	db.DB.Exec("UPDATE normalize_jobs SET status='running', updated_at=? WHERE id=?", time.Now().Format(time.RFC3339), jobID)

	maxParallel := cfg.Parallel
	if maxParallel < 1 {
		maxParallel = 1
	}
	hwAccel := cfg.HWAccel
	if hwAccel == "auto" {
		hwAccel = normalize.DetectHWAccel()
	}
	maxHW := 4
	switch hwAccel {
	case "nvenc":
		maxHW = 2
	case "cpu":
		maxHW = 2
	}
	if maxParallel > maxHW {
		maxParallel = maxHW
	}

	var mu sync.Mutex
	succeeded, failed, skipped, completed := 0, 0, 0, 0
	cancelled := false

	sem := make(chan struct{}, maxParallel)
	var wg sync.WaitGroup

	for i, item := range items {
		select {
		case <-stopCh:
			mu.Lock()
			cancelled = true
			mu.Unlock()
		default:
		}
		mu.Lock()
		if cancelled {
			mu.Unlock()
			break
		}
		mu.Unlock()

		wg.Add(1)
		sem <- struct{}{}

		go func(idx int, it NormalizeStartItem) {
			defer wg.Done()
			defer func() { <-sem }()
			defer func() {
				if r := recover(); r != nil {
					log.Printf("[normalize] panic processing %s: %v", it.Title, r)
					db.DB.Exec("UPDATE normalize_items SET status='failed', error=?, updated_at=? WHERE job_id=? AND item_index=?",
						fmt.Sprintf("panic: %v", r), time.Now().Format(time.RFC3339), jobID, idx)
					mu.Lock()
					completed++
					failed++
					mu.Unlock()
				}
			}()

			select {
			case <-stopCh:
				mu.Lock()
				cancelled = true
				mu.Unlock()
				return
			default:
			}

			db.DB.Exec("UPDATE normalize_items SET status='measuring', updated_at=? WHERE job_id=? AND item_index=?",
				time.Now().Format(time.RFC3339), jobID, idx)
			dur, _ := normalize.GetDuration(it.FilePath)
			db.DB.Exec("UPDATE normalize_items SET duration_secs=? WHERE job_id=? AND item_index=?", dur, jobID, idx)

			// Build per-item config, respecting per-item LUFS override from DB
			itemCfg := cfg
			var itemTargetLUFS float64
			err := db.DB.QueryRow("SELECT target_lufs FROM normalize_items WHERE job_id=? AND item_index=?", jobID, idx).Scan(&itemTargetLUFS)
			if err == nil && itemTargetLUFS != 0 {
				itemCfg.TargetLUFS = itemTargetLUFS
			}

			onProgress := func(p normalize.FileProgress) {
				db.DB.Exec("UPDATE normalize_items SET status=?, progress_pct=?, updated_at=? WHERE job_id=? AND item_index=?",
					p.Phase, p.Percent, time.Now().Format(time.RFC3339), jobID, idx)
			}

			result := normalize.NormalizeFile(it.FilePath, itemCfg, dur, onProgress, nil)

			mu.Lock()
			completed++
			switch result.Status {
			case "done":
				succeeded++
			case "failed":
				failed++
			case "skipped":
				skipped++
			}
			mu.Unlock()

			switch result.Status {
			case "done":
				db.DB.Exec("UPDATE normalize_items SET status='done', measured_lufs=?, progress_pct=100, updated_at=? WHERE job_id=? AND item_index=?",
					result.MeasuredLUFS, time.Now().Format(time.RFC3339), jobID, idx)
				if fi, err := os.Stat(it.FilePath); err == nil {
					db.DB.Exec(`INSERT OR REPLACE INTO normalize_history (file_path, file_size, file_mtime, target_lufs, measured_lufs, normalized_at, job_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
						it.FilePath, fi.Size(), fi.ModTime().Unix(), itemCfg.TargetLUFS, result.MeasuredLUFS, time.Now().Format(time.RFC3339), jobID)
				}
			case "failed":
				db.DB.Exec("UPDATE normalize_items SET status='failed', error=?, updated_at=? WHERE job_id=? AND item_index=?",
					result.Error, time.Now().Format(time.RFC3339), jobID, idx)
			case "skipped":
				db.DB.Exec("UPDATE normalize_items SET status='skipped', error=?, updated_at=? WHERE job_id=? AND item_index=?",
					result.Error, time.Now().Format(time.RFC3339), jobID, idx)
			}

			mu.Lock()
			db.DB.Exec("UPDATE normalize_jobs SET completed=?, succeeded=?, failed=?, skipped=?, updated_at=? WHERE id=?",
				completed, succeeded, failed, skipped, time.Now().Format(time.RFC3339), jobID)
			mu.Unlock()

			log.Printf("[normalize] %s: %s (%s)", it.Title, result.Status, it.FilePath)
		}(i, item)
	}

	wg.Wait()

	// Sweep any items stuck in intermediate states (e.g., from panics or unexpected errors)
	res, _ := db.DB.Exec("UPDATE normalize_items SET status='failed', error='interrupted', updated_at=? WHERE job_id=? AND status IN ('measuring', 'normalizing')",
		time.Now().Format(time.RFC3339), jobID)
	if swept, _ := res.RowsAffected(); swept > 0 {
		log.Printf("[normalize] swept %d stuck items for job %s", swept, jobID)
		mu.Lock()
		failed += int(swept)
		completed += int(swept)
		db.DB.Exec("UPDATE normalize_jobs SET completed=?, succeeded=?, failed=?, skipped=?, updated_at=? WHERE id=?",
			completed, succeeded, failed, skipped, time.Now().Format(time.RFC3339), jobID)
		mu.Unlock()
	}

	mu.Lock()
	wasCancelled := cancelled
	mu.Unlock()

	if wasCancelled {
		db.DB.Exec("UPDATE normalize_jobs SET status='cancelled', updated_at=? WHERE id=?", time.Now().Format(time.RFC3339), jobID)
	} else {
		db.DB.Exec("UPDATE normalize_jobs SET status='completed', updated_at=? WHERE id=?", time.Now().Format(time.RFC3339), jobID)
	}
}

func StopNormalize(w http.ResponseWriter, r *http.Request) {
	jobID := chi.URLParam(r, "id")
	activeNormalizeJobsMu.Lock()
	ch, ok := activeNormalizeJobs[jobID]
	if ok {
		delete(activeNormalizeJobs, jobID)
	}
	activeNormalizeJobsMu.Unlock()
	if ok {
		close(ch)
		writeJSON(w, http.StatusOK, map[string]string{"status": "stopping"})
	} else {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Job not found or not running"})
	}
}

func RetryNormalize(w http.ResponseWriter, r *http.Request) {
	origJobID := chi.URLParam(r, "id")
	if origJobID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Job ID required"})
		return
	}

	rows, err := db.DB.Query(
		"SELECT file_path, movie_title, radarr_movie_id, tmdb_id FROM normalize_items WHERE job_id=? AND status='failed' ORDER BY item_index",
		origJobID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to query failed items"})
		return
	}
	defer rows.Close()

	var items []NormalizeStartItem
	for rows.Next() {
		var it NormalizeStartItem
		rows.Scan(&it.FilePath, &it.Title, &it.RadarrID, &it.TmdbID)
		items = append(items, it)
	}
	if len(items) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "No failed items to retry"})
		return
	}

	var cfgJSON string
	db.DB.QueryRow("SELECT config_snapshot FROM normalize_jobs WHERE id=?", origJobID).Scan(&cfgJSON)
	var ncfg normalize.NormalizeConfig
	if err := json.Unmarshal([]byte(cfgJSON), &ncfg); err != nil {
		cfgDB := config.GetNormalizeConfig()
		ncfg = normalize.NormalizeConfig{
			TargetLUFS: cfgDB.TargetLUFS, HWAccel: cfgDB.HWAccel, AudioBitrate: cfgDB.AudioBitrate,
			Backup: cfgDB.Backup, Parallel: cfgDB.Parallel, VideoMode: cfgDB.VideoMode,
			MeasureMode: cfgDB.MeasureMode,
		}
	}

	jobID := uuid.New().String()
	cfgOut, _ := json.Marshal(ncfg)
	now := time.Now().Format(time.RFC3339)
	db.DB.Exec(`INSERT INTO normalize_jobs (id, status, total, config_snapshot, created_at, updated_at) VALUES (?, 'pending', ?, ?, ?, ?)`,
		jobID, len(items), string(cfgOut), now, now)
	for i, item := range items {
		db.DB.Exec(`INSERT INTO normalize_items (job_id, item_index, file_path, movie_title, radarr_movie_id, tmdb_id, status, target_lufs) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
			jobID, i, item.FilePath, item.Title, item.RadarrID, item.TmdbID, ncfg.TargetLUFS)
	}

	stopCh := make(chan struct{})
	activeNormalizeJobsMu.Lock()
	activeNormalizeJobs[jobID] = stopCh
	activeNormalizeJobsMu.Unlock()
	go runNormalizeJob(jobID, items, ncfg, stopCh)

	// Mark original failed items as retried so they can't be retried again
	db.DB.Exec("UPDATE normalize_items SET status='retried', error=?, updated_at=? WHERE job_id=? AND status='failed'",
		"retried in job "+jobID, now, origJobID)
	db.DB.Exec(`UPDATE normalize_jobs SET
		failed = (SELECT COUNT(*) FROM normalize_items WHERE job_id=? AND status='failed'),
		completed = (SELECT COUNT(*) FROM normalize_items WHERE job_id=? AND status IN ('done','failed','skipped','retried')),
		updated_at=?
	WHERE id=?`, origJobID, origJobID, now, origJobID)

	writeJSON(w, http.StatusAccepted, map[string]string{"job_id": jobID})
}

func GetNormalizeStatus(w http.ResponseWriter, r *http.Request) {
	if activeSSEConnections.Load() >= int32(maxSSEConnections) {
		http.Error(w, `{"error":"too many SSE connections"}`, http.StatusTooManyRequests)
		return
	}
	activeSSEConnections.Add(1)
	defer activeSSEConnections.Add(-1)

	jobID := chi.URLParam(r, "id")
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming not supported", http.StatusInternalServerError)
		return
	}
	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		var status string
		var total, completed, succeeded, failed, skipped int
		err := db.DB.QueryRow(
			"SELECT status, total, completed, succeeded, failed, skipped FROM normalize_jobs WHERE id=?", jobID,
		).Scan(&status, &total, &completed, &succeeded, &failed, &skipped)
		if err != nil {
			fmt.Fprintf(w, "event: error\ndata: {\"error\":\"job not found\"}\n\n")
			flusher.Flush()
			return
		}
		data, _ := json.Marshal(map[string]interface{}{
			"status": status, "total": total, "completed": completed,
			"succeeded": succeeded, "failed": failed, "skipped": skipped,
		})
		fmt.Fprintf(w, "event: progress\ndata: %s\n\n", data)
		itemRows, _ := db.DB.Query(
			"SELECT file_path, movie_title, status, measured_lufs, error, progress_pct, target_lufs FROM normalize_items WHERE job_id=? ORDER BY item_index", jobID)
		if itemRows != nil {
			type itemStatus struct {
				FilePath    string   `json:"file_path"`
				Title       string   `json:"title"`
				Status      string   `json:"status"`
				LUFS        *float64 `json:"measured_lufs,omitempty"`
				TargetLUFS  *float64 `json:"target_lufs,omitempty"`
				Error       string   `json:"error,omitempty"`
				ProgressPct float64  `json:"progress_pct"`
			}
			var items []itemStatus
			for itemRows.Next() {
				var is itemStatus
				var lufs, targetLufs *float64
				var errStr string
				itemRows.Scan(&is.FilePath, &is.Title, &is.Status, &lufs, &errStr, &is.ProgressPct, &targetLufs)
				is.LUFS = lufs
				is.TargetLUFS = targetLufs
				is.Error = errStr
				items = append(items, is)
			}
			itemRows.Close()
			idata, _ := json.Marshal(items)
			fmt.Fprintf(w, "event: items\ndata: %s\n\n", idata)
		}
		flusher.Flush()
		if status == "completed" || status == "failed" || status == "cancelled" {
			fmt.Fprintf(w, "event: done\ndata: {\"status\":\"%s\"}\n\n", status)
			flusher.Flush()
			return
		}
		time.Sleep(1 * time.Second)
	}
}

func GetNormalizeJobs(w http.ResponseWriter, r *http.Request) {
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	perPage, _ := strconv.Atoi(r.URL.Query().Get("per_page"))
	if perPage < 1 || perPage > 100 {
		perPage = 10
	}

	var total int
	db.DB.QueryRow("SELECT COUNT(*) FROM normalize_jobs").Scan(&total)

	offset := (page - 1) * perPage
	rows, err := db.DB.Query(
		"SELECT id, status, total, completed, succeeded, failed, skipped, created_at, updated_at FROM normalize_jobs ORDER BY created_at DESC LIMIT ? OFFSET ?", perPage, offset)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to query jobs"})
		return
	}
	defer rows.Close()
	var jobs []NormalizeJobResponse
	for rows.Next() {
		var j NormalizeJobResponse
		rows.Scan(&j.ID, &j.Status, &j.Total, &j.Completed, &j.Succeeded, &j.Failed, &j.Skipped, &j.CreatedAt, &j.UpdatedAt)
		jobs = append(jobs, j)
	}
	if jobs == nil {
		jobs = []NormalizeJobResponse{}
	}
	writeJSON(w, http.StatusOK, PaginatedNormalizeJobsResponse{
		Jobs:    jobs,
		Total:   total,
		Page:    page,
		PerPage: perPage,
	})
}

func GetNormalizeJob(w http.ResponseWriter, r *http.Request) {
	jobID := chi.URLParam(r, "id")
	var j NormalizeJobResponse
	err := db.DB.QueryRow(
		"SELECT id, status, total, completed, succeeded, failed, skipped, created_at, updated_at FROM normalize_jobs WHERE id=?", jobID,
	).Scan(&j.ID, &j.Status, &j.Total, &j.Completed, &j.Succeeded, &j.Failed, &j.Skipped, &j.CreatedAt, &j.UpdatedAt)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Job not found"})
		return
	}

	detail := NormalizeJobDetailResponse{NormalizeJobResponse: j}
	rows, err := db.DB.Query(
		"SELECT file_path, movie_title, status, measured_lufs, target_lufs, error FROM normalize_items WHERE job_id=? ORDER BY item_index", jobID)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var item NormalizeJobItem
			var lufs, tlufs *float64
			var errStr *string
			rows.Scan(&item.FilePath, &item.Title, &item.Status, &lufs, &tlufs, &errStr)
			item.MeasuredLUFS = lufs
			item.TargetLUFS = tlufs
			if errStr != nil {
				item.Error = *errStr
			}
			detail.Items = append(detail.Items, item)
		}
	}
	if detail.Items == nil {
		detail.Items = []NormalizeJobItem{}
	}
	writeJSON(w, http.StatusOK, detail)
}

func GetNormalizeConfigHandler(w http.ResponseWriter, r *http.Request) {
	cfg := config.GetNormalizeConfig()
	writeJSON(w, http.StatusOK, cfg)
}

var (
	validHWAccel      = map[string]bool{"auto": true, "vaapi": true, "nvenc": true, "cpu": true}
	validVideoMode    = map[string]bool{"copy": true, "reencode": true}
	validMeasureMode  = map[string]bool{"auto": true, "full": true, "sample": true}
	validAudioBitrate = map[string]bool{"128k": true, "192k": true, "256k": true, "320k": true}
)

func UpdateNormalizeConfig(w http.ResponseWriter, r *http.Request) {
	var cfg config.NormalizeConfig
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}
	if cfg.TargetLUFS < -70.0 || cfg.TargetLUFS > -5.0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Target LUFS must be between -70.0 and -5.0"})
		return
	}
	if !validHWAccel[cfg.HWAccel] {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid HW acceleration value"})
		return
	}
	if !validAudioBitrate[cfg.AudioBitrate] {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid audio bitrate"})
		return
	}
	if !validVideoMode[cfg.VideoMode] {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid video mode"})
		return
	}
	if !validMeasureMode[cfg.MeasureMode] {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid measure mode"})
		return
	}
	if cfg.Parallel < 1 || cfg.Parallel > 8 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Parallel must be between 1 and 8"})
		return
	}
	fields := map[string]string{
		"normalize_target_lufs":   fmt.Sprintf("%.1f", cfg.TargetLUFS),
		"normalize_hwaccel":       cfg.HWAccel,
		"normalize_audio_bitrate": cfg.AudioBitrate,
		"normalize_backup":        strconv.FormatBool(cfg.Backup),
		"normalize_parallel":      strconv.Itoa(cfg.Parallel),
		"normalize_video_mode":    cfg.VideoMode,
		"normalize_measure_mode":  cfg.MeasureMode,
	}
	if err := config.SetFields(fields); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to save config"})
		return
	}
	writeJSON(w, http.StatusOK, cfg)
}

func ClearNormalizeHistory(w http.ResponseWriter, r *http.Request) {
	tx, err := db.DB.Begin()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to start transaction"})
		return
	}
	tx.Exec("DELETE FROM normalize_items")
	tx.Exec("DELETE FROM normalize_jobs")
	tx.Exec("DELETE FROM normalize_history")
	if err := tx.Commit(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to clear history"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"cleared": true})
}
 true})
}
