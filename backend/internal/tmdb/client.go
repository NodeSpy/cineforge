package tmdb

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"sync"
	"time"
)

type ThrottleCallback func(wait time.Duration, reason string)

type Client struct {
	APIKey          string
	HTTPClient      *http.Client
	BaseDelay       time.Duration
	OnThrottle      ThrottleCallback
	mu              sync.Mutex
	lastRequestTime time.Time
}

func NewClient(apiKey string) *Client {
	return &Client{
		APIKey: apiKey,
		HTTPClient: &http.Client{
			Timeout: 15 * time.Second,
		},
		BaseDelay: 250 * time.Millisecond,
	}
}

type SearchResult struct {
	Page         int     `json:"page"`
	Results      []Movie `json:"results"`
	TotalPages   int     `json:"total_pages"`
	TotalResults int     `json:"total_results"`
}

type Movie struct {
	ID            int     `json:"id"`
	Title         string  `json:"title"`
	OriginalTitle string  `json:"original_title"`
	Overview      string  `json:"overview"`
	ReleaseDate   string  `json:"release_date"`
	PosterPath    string  `json:"poster_path"`
	BackdropPath  string  `json:"backdrop_path"`
	VoteAverage   float64 `json:"vote_average"`
	VoteCount     int     `json:"vote_count"`
	Popularity    float64 `json:"popularity"`
	GenreIDs      []int   `json:"genre_ids"`
	Adult         bool    `json:"adult"`
}

func (m *Movie) PosterURL() string {
	if m.PosterPath == "" {
		return ""
	}
	return "https://image.tmdb.org/t/p/w200" + m.PosterPath
}

func (m *Movie) Year() string {
	if len(m.ReleaseDate) >= 4 {
		return m.ReleaseDate[:4]
	}
	return ""
}

func (c *Client) pace() {
	c.mu.Lock()
	defer c.mu.Unlock()

	if !c.lastRequestTime.IsZero() {
		elapsed := time.Since(c.lastRequestTime)
		if elapsed < c.BaseDelay {
			sleep := c.BaseDelay - elapsed
			time.Sleep(sleep)
		}
	}
	c.lastRequestTime = time.Now()
}

const maxRetries = 5

func (c *Client) doWithRetry(req *http.Request, label string) (*http.Response, error) {
	backoff := 1 * time.Second

	for attempt := 0; attempt <= maxRetries; attempt++ {
		if attempt > 0 {
			newReq, err := http.NewRequest(req.Method, req.URL.String(), nil)
			if err != nil {
				return nil, err
			}
			newReq.Header = req.Header
			req = newReq
		}

		c.pace()

		resp, err := c.HTTPClient.Do(req)
		if err != nil {
			log.Printf("[tmdb] ERROR %s: request failed: %v", label, err)
			return nil, fmt.Errorf("TMDb request failed: %w", err)
		}

		if resp.StatusCode == http.StatusTooManyRequests {
			resp.Body.Close()

			retryAfter := resp.Header.Get("Retry-After")
			wait := backoff
			if retryAfter != "" {
				if seconds, err := strconv.Atoi(retryAfter); err == nil {
					wait = time.Duration(seconds) * time.Second
				}
			}

			if wait > 30*time.Second {
				wait = 30 * time.Second
			}

			log.Printf("[tmdb] THROTTLED %s: 429 Too Many Requests, backing off %v (attempt %d/%d)", label, wait, attempt+1, maxRetries)

			if c.OnThrottle != nil {
				c.OnThrottle(wait, "TMDb rate limit (429)")
			}

			if attempt == maxRetries {
				return nil, fmt.Errorf("TMDb rate limited after %d retries", maxRetries)
			}

			time.Sleep(wait)
			backoff *= 2
			if backoff > 30*time.Second {
				backoff = 30 * time.Second
			}
			continue
		}

		return resp, nil
	}

	return nil, fmt.Errorf("TMDb request failed after %d retries", maxRetries)
}

func (c *Client) SearchMovie(title string, year string) (*SearchResult, error) {
	params := url.Values{}
	params.Set("query", title)
	params.Set("include_adult", "false")
	params.Set("language", "en-US")
	params.Set("page", "1")
	if year != "" {
		params.Set("year", year)
	}

	label := fmt.Sprintf("search %q year=%s", title, year)
	log.Printf("[tmdb] Searching: %q year=%s", title, year)

	reqURL := fmt.Sprintf("https://api.themoviedb.org/3/search/movie?%s", params.Encode())
	req, err := http.NewRequest("GET", reqURL, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	req.Header.Set("Accept", "application/json")

	resp, err := c.doWithRetry(req, label)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("[tmdb] ERROR %s: failed to read response: %v", label, err)
		return nil, fmt.Errorf("failed to read TMDb response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		log.Printf("[tmdb] ERROR %s: status %d: %s", label, resp.StatusCode, string(body))
		return nil, fmt.Errorf("TMDb returned status %d: %s", resp.StatusCode, string(body))
	}

	var result SearchResult
	if err := json.Unmarshal(body, &result); err != nil {
		log.Printf("[tmdb] ERROR %s: failed to parse response: %v", label, err)
		return nil, fmt.Errorf("failed to parse TMDb response: %w", err)
	}

	log.Printf("[tmdb] OK %s: %d results", label, len(result.Results))
	return &result, nil
}

func (c *Client) GetMovie(tmdbID int) (*Movie, error) {
	label := fmt.Sprintf("get movie #%d", tmdbID)
	log.Printf("[tmdb] Fetching movie #%d", tmdbID)

	reqURL := fmt.Sprintf("https://api.themoviedb.org/3/movie/%d?language=en-US", tmdbID)
	req, err := http.NewRequest("GET", reqURL, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	req.Header.Set("Accept", "application/json")

	resp, err := c.doWithRetry(req, label)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("[tmdb] ERROR %s: failed to read response: %v", label, err)
		return nil, fmt.Errorf("failed to read TMDb response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		log.Printf("[tmdb] ERROR %s: status %d: %s", label, resp.StatusCode, string(body))
		return nil, fmt.Errorf("TMDb returned status %d: %s", resp.StatusCode, string(body))
	}

	var movie Movie
	if err := json.Unmarshal(body, &movie); err != nil {
		log.Printf("[tmdb] ERROR %s: failed to parse response: %v", label, err)
		return nil, fmt.Errorf("failed to parse TMDb response: %w", err)
	}

	log.Printf("[tmdb] OK %s: %q (%s)", label, movie.Title, movie.Year())
	return &movie, nil
}
