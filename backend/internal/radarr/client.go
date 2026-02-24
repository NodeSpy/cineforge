package radarr

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

type Client struct {
	BaseURL    string
	APIKey     string
	HTTPClient *http.Client
}

func NewClient(baseURL, apiKey string) *Client {
	return &Client{
		BaseURL: baseURL,
		APIKey:  apiKey,
		HTTPClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

type Movie struct {
	ID                  int         `json:"id,omitempty"`
	Title               string      `json:"title"`
	OriginalTitle       string      `json:"originalTitle,omitempty"`
	SortTitle           string      `json:"sortTitle,omitempty"`
	Year                int         `json:"year"`
	TmdbID              int         `json:"tmdbId"`
	ImdbID              string      `json:"imdbId,omitempty"`
	Overview            string      `json:"overview,omitempty"`
	Status              string      `json:"status,omitempty"`
	Studio              string      `json:"studio,omitempty"`
	Certification       string      `json:"certification,omitempty"`
	Runtime             int         `json:"runtime,omitempty"`
	Genres              []string    `json:"genres,omitempty"`
	Images              []Image     `json:"images,omitempty"`
	Monitored           bool        `json:"monitored"`
	HasFile             bool        `json:"hasFile,omitempty"`
	SizeOnDisk          int64       `json:"sizeOnDisk,omitempty"`
	MovieFileID         int         `json:"movieFileId,omitempty"`
	QualityProfileID    int         `json:"qualityProfileId"`
	RootFolderPath      string      `json:"rootFolderPath,omitempty"`
	Path                string      `json:"path,omitempty"`
	MinimumAvailability string      `json:"minimumAvailability"`
	Added               string      `json:"added,omitempty"`
	Tags                []int       `json:"tags,omitempty"`
	MovieFile           *MovieFile  `json:"movieFile,omitempty"`
	AddOptions          *AddOptions `json:"addOptions,omitempty"`
}

type Image struct {
	CoverType string `json:"coverType"`
	RemoteURL string `json:"remoteUrl,omitempty"`
	URL       string `json:"url,omitempty"`
}

type AddOptions struct {
	SearchForMovie bool `json:"searchForMovie"`
}

type Tag struct {
	ID    int    `json:"id"`
	Label string `json:"label"`
}

type QualityProfile struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

type RootFolder struct {
	ID        int    `json:"id"`
	Path      string `json:"path"`
	FreeSpace int64  `json:"freeSpace"`
}

type SystemStatus struct {
	Version string `json:"version"`
	AppName string `json:"appName"`
}

type MovieFile struct {
	ID                  int        `json:"id"`
	MovieID             int        `json:"movieId"`
	RelativePath        string     `json:"relativePath,omitempty"`
	Path                string     `json:"path,omitempty"`
	Size                int64      `json:"size"`
	DateAdded           string     `json:"dateAdded,omitempty"`
	Quality             *Quality   `json:"quality,omitempty"`
	MediaInfo           *MediaInfo `json:"mediaInfo,omitempty"`
	Languages           []Language `json:"languages,omitempty"`
	QualityCutoffNotMet bool       `json:"qualityCutoffNotMet,omitempty"`
}

type MediaInfo struct {
	AudioBitrate          int64   `json:"audioBitrate"`
	AudioChannels         float64 `json:"audioChannels"`
	AudioCodec            string  `json:"audioCodec"`
	AudioLanguages        string  `json:"audioLanguages"`
	AudioStreamCount      int     `json:"audioStreamCount"`
	VideoBitDepth         int     `json:"videoBitDepth"`
	VideoBitrate          int64   `json:"videoBitrate"`
	VideoCodec            string  `json:"videoCodec"`
	VideoFps              float64 `json:"videoFps"`
	VideoDynamicRange     string  `json:"videoDynamicRange"`
	VideoDynamicRangeType string  `json:"videoDynamicRangeType"`
	Resolution            string  `json:"resolution"`
	RunTime               string  `json:"runTime"`
	ScanType              string  `json:"scanType"`
	Subtitles             string  `json:"subtitles"`
}

type Quality struct {
	Quality  QualityDetail `json:"quality"`
	Revision Revision      `json:"revision,omitempty"`
}

type QualityDetail struct {
	ID         int    `json:"id"`
	Name       string `json:"name"`
	Source     string `json:"source"`
	Resolution int    `json:"resolution"`
}

type Revision struct {
	Version int  `json:"version"`
	Real    int  `json:"real"`
	IsRepack bool `json:"isRepack"`
}

type Language struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

func (c *Client) doRequest(method, path string, body interface{}) ([]byte, error) {
	var reqBody io.Reader
	if body != nil {
		jsonBytes, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reqBody = bytes.NewReader(jsonBytes)
	}

	reqURL := fmt.Sprintf("%s/api/v3%s", c.BaseURL, path)
	req, err := http.NewRequest(method, reqURL, reqBody)
	if err != nil {
		return nil, err
	}

	req.Header.Set("X-Api-Key", c.APIKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("Radarr request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read Radarr response: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("Radarr returned status %d: %s", resp.StatusCode, string(respBody))
	}

	return respBody, nil
}

func (c *Client) GetStatus() (*SystemStatus, error) {
	body, err := c.doRequest("GET", "/system/status", nil)
	if err != nil {
		return nil, err
	}

	var status SystemStatus
	if err := json.Unmarshal(body, &status); err != nil {
		return nil, err
	}

	return &status, nil
}

func (c *Client) GetQualityProfiles() ([]QualityProfile, error) {
	body, err := c.doRequest("GET", "/qualityprofile", nil)
	if err != nil {
		return nil, err
	}

	var profiles []QualityProfile
	if err := json.Unmarshal(body, &profiles); err != nil {
		return nil, err
	}

	return profiles, nil
}

func (c *Client) GetRootFolders() ([]RootFolder, error) {
	body, err := c.doRequest("GET", "/rootfolder", nil)
	if err != nil {
		return nil, err
	}

	var folders []RootFolder
	if err := json.Unmarshal(body, &folders); err != nil {
		return nil, err
	}

	return folders, nil
}

func (c *Client) GetTags() ([]Tag, error) {
	body, err := c.doRequest("GET", "/tag", nil)
	if err != nil {
		return nil, err
	}

	var tags []Tag
	if err := json.Unmarshal(body, &tags); err != nil {
		return nil, err
	}

	return tags, nil
}

func (c *Client) CreateTag(label string) (*Tag, error) {
	body, err := c.doRequest("POST", "/tag", Tag{Label: label})
	if err != nil {
		return nil, err
	}

	var tag Tag
	if err := json.Unmarshal(body, &tag); err != nil {
		return nil, err
	}

	return &tag, nil
}

func (c *Client) LookupByTmdbID(tmdbID int) (*Movie, error) {
	path := fmt.Sprintf("/movie/lookup?term=tmdb:%d", tmdbID)
	body, err := c.doRequest("GET", path, nil)
	if err != nil {
		return nil, err
	}

	var movies []Movie
	if err := json.Unmarshal(body, &movies); err != nil {
		return nil, err
	}

	if len(movies) == 0 {
		return nil, fmt.Errorf("no movie found for TMDb ID %d", tmdbID)
	}

	return &movies[0], nil
}

func (c *Client) LookupByImdbID(imdbID string) (*Movie, error) {
	path := fmt.Sprintf("/movie/lookup?term=imdb:%s", url.QueryEscape(imdbID))
	body, err := c.doRequest("GET", path, nil)
	if err != nil {
		return nil, err
	}

	var movies []Movie
	if err := json.Unmarshal(body, &movies); err != nil {
		return nil, err
	}

	if len(movies) == 0 {
		return nil, fmt.Errorf("no movie found for IMDb ID %s", imdbID)
	}

	return &movies[0], nil
}

func (c *Client) AddMovie(movie Movie) (*Movie, error) {
	body, err := c.doRequest("POST", "/movie", movie)
	if err != nil {
		return nil, err
	}

	var added Movie
	if err := json.Unmarshal(body, &added); err != nil {
		return nil, err
	}

	return &added, nil
}

func (c *Client) GetMovies() ([]Movie, error) {
	body, err := c.doRequest("GET", "/movie", nil)
	if err != nil {
		return nil, err
	}

	var movies []Movie
	if err := json.Unmarshal(body, &movies); err != nil {
		return nil, err
	}

	return movies, nil
}

func (c *Client) GetMovie(id int) (*Movie, error) {
	path := fmt.Sprintf("/movie/%d", id)
	body, err := c.doRequest("GET", path, nil)
	if err != nil {
		return nil, err
	}
	var movie Movie
	if err := json.Unmarshal(body, &movie); err != nil {
		return nil, err
	}
	return &movie, nil
}

func (c *Client) GetMovieFiles(movieID int) ([]MovieFile, error) {
	path := fmt.Sprintf("/moviefile?movieId=%d", movieID)
	body, err := c.doRequest("GET", path, nil)
	if err != nil {
		return nil, err
	}
	var files []MovieFile
	if err := json.Unmarshal(body, &files); err != nil {
		return nil, err
	}
	return files, nil
}
