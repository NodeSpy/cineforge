package jobs

import (
	"encoding/json"
	"sync"
	"time"

	"github.com/google/uuid"

	"cineforge/internal/db"
)

type Status string

const (
	StatusPending   Status = "pending"
	StatusRunning   Status = "running"
	StatusCompleted Status = "completed"
	StatusFailed    Status = "failed"
)

type Result struct {
	Title  string `json:"title"`
	TmdbID int    `json:"tmdb_id,omitempty"`
	ImdbID string `json:"imdb_id,omitempty"`
	Status string `json:"status"`
	Error  string `json:"error,omitempty"`
}

type Job struct {
	ID                 string           `json:"id"`
	Type               string           `json:"type"`
	Status             Status           `json:"status"`
	Total              int              `json:"total"`
	Completed          int              `json:"completed"`
	Succeeded          int              `json:"succeeded"`
	Failed             int              `json:"failed"`
	Results            []Result         `json:"results"`
	CreatedAt          time.Time        `json:"created_at"`
	UpdatedAt          time.Time        `json:"updated_at"`
	ReconciledResults  json.RawMessage  `json:"reconciled_results,omitempty"`
	ReconciledAt       *time.Time       `json:"reconciled_at,omitempty"`
}

type Manager struct {
	mu   sync.RWMutex
	jobs map[string]*Job
}

var DefaultManager = &Manager{
	jobs: make(map[string]*Job),
}

func Create(jobType string, total int) *Job {
	job := &Job{
		ID:        uuid.New().String(),
		Type:      jobType,
		Status:    StatusPending,
		Total:     total,
		Results:   make([]Result, 0),
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	DefaultManager.mu.Lock()
	DefaultManager.jobs[job.ID] = job
	DefaultManager.mu.Unlock()

	saveJob(job)
	return job
}

func Get(id string) *Job {
	DefaultManager.mu.RLock()
	job, ok := DefaultManager.jobs[id]
	DefaultManager.mu.RUnlock()

	if ok {
		return job
	}

	return loadJob(id)
}

func (j *Job) Start() {
	DefaultManager.mu.Lock()
	j.Status = StatusRunning
	j.UpdatedAt = time.Now()
	DefaultManager.mu.Unlock()
	saveJob(j)
}

func (j *Job) AddResult(result Result) {
	DefaultManager.mu.Lock()
	j.Results = append(j.Results, result)
	j.Completed++
	if result.Status == "success" {
		j.Succeeded++
	} else if result.Status == "failed" {
		j.Failed++
	}
	j.UpdatedAt = time.Now()
	DefaultManager.mu.Unlock()
	saveJob(j)
}

func (j *Job) Complete() {
	DefaultManager.mu.Lock()
	j.Status = StatusCompleted
	j.UpdatedAt = time.Now()
	DefaultManager.mu.Unlock()
	saveJob(j)
}

func (j *Job) Fail() {
	DefaultManager.mu.Lock()
	j.Status = StatusFailed
	j.UpdatedAt = time.Now()
	DefaultManager.mu.Unlock()
	saveJob(j)
}

func GetRecent(limit int) []*Job {
	DefaultManager.mu.RLock()
	defer DefaultManager.mu.RUnlock()

	jobList := make([]*Job, 0, len(DefaultManager.jobs))
	for _, j := range DefaultManager.jobs {
		jobList = append(jobList, j)
	}

	for i := 0; i < len(jobList); i++ {
		for j := i + 1; j < len(jobList); j++ {
			if jobList[j].CreatedAt.After(jobList[i].CreatedAt) {
				jobList[i], jobList[j] = jobList[j], jobList[i]
			}
		}
	}

	if len(jobList) > limit {
		jobList = jobList[:limit]
	}

	return jobList
}

func saveJob(job *Job) {
	resultsJSON, _ := json.Marshal(job.Results)
	db.DB.Exec(`INSERT INTO jobs (id, type, status, total, completed, succeeded, failed, results, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET status=excluded.status, total=excluded.total,
		completed=excluded.completed, succeeded=excluded.succeeded, failed=excluded.failed,
		results=excluded.results, updated_at=excluded.updated_at`,
		job.ID, job.Type, string(job.Status), job.Total, job.Completed,
		job.Succeeded, job.Failed, string(resultsJSON), job.CreatedAt, job.UpdatedAt)
}

func loadJob(id string) *Job {
	row := db.DB.QueryRow("SELECT id, type, status, total, completed, succeeded, failed, results, created_at, updated_at, reconciled_results, reconciled_at FROM jobs WHERE id = ?", id)

	var job Job
	var resultsJSON string
	var status string
	var reconciledJSON *string
	var reconciledAt *time.Time
	err := row.Scan(&job.ID, &job.Type, &status, &job.Total, &job.Completed,
		&job.Succeeded, &job.Failed, &resultsJSON, &job.CreatedAt, &job.UpdatedAt,
		&reconciledJSON, &reconciledAt)
	if err != nil {
		return nil
	}

	job.Status = Status(status)
	json.Unmarshal([]byte(resultsJSON), &job.Results)
	if reconciledJSON != nil && *reconciledJSON != "" {
		job.ReconciledResults = json.RawMessage(*reconciledJSON)
	}
	job.ReconciledAt = reconciledAt

	DefaultManager.mu.Lock()
	DefaultManager.jobs[job.ID] = &job
	DefaultManager.mu.Unlock()

	return &job
}
