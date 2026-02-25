package sonarr

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
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

type Series struct {
	ID                int       `json:"id,omitempty"`
	Title             string    `json:"title"`
	SortTitle         string    `json:"sortTitle,omitempty"`
	Year              int       `json:"year"`
	TvdbID            int       `json:"tvdbId,omitempty"`
	TvRageID          int       `json:"tvRageId,omitempty"`
	TvMazeID          int       `json:"tvMazeId,omitempty"`
	ImdbID            string    `json:"imdbId,omitempty"`
	Overview          string    `json:"overview,omitempty"`
	Status            string    `json:"status,omitempty"`
	Network           string    `json:"network,omitempty"`
	Runtime           int       `json:"runtime,omitempty"`
	Genres            []string  `json:"genres,omitempty"`
	Images            []Image   `json:"images,omitempty"`
	Seasons           []Season  `json:"seasons,omitempty"`
	Monitored         bool      `json:"monitored"`
	SeriesType        string    `json:"seriesType,omitempty"`
	Path              string    `json:"path,omitempty"`
	QualityProfileID  int       `json:"qualityProfileId"`
	RootFolderPath    string    `json:"rootFolderPath,omitempty"`
	Added             string    `json:"added,omitempty"`
	Tags              []int     `json:"tags,omitempty"`
	Certification     string    `json:"certification,omitempty"`
	Statistics        *Stats    `json:"statistics,omitempty"`
}

type Season struct {
	SeasonNumber int    `json:"seasonNumber"`
	Monitored    bool   `json:"monitored"`
	Statistics   *Stats `json:"statistics,omitempty"`
}

type Stats struct {
	EpisodeFileCount  int   `json:"episodeFileCount"`
	EpisodeCount      int   `json:"episodeCount"`
	TotalEpisodeCount int   `json:"totalEpisodeCount"`
	SizeOnDisk        int64 `json:"sizeOnDisk"`
	PercentOfEpisodes float64 `json:"percentOfEpisodes"`
	SeasonCount       int   `json:"seasonCount,omitempty"`
}

type Episode struct {
	ID                 int    `json:"id"`
	SeriesID           int    `json:"seriesId"`
	TvdbID             int    `json:"tvdbId,omitempty"`
	EpisodeFileID      int    `json:"episodeFileId"`
	SeasonNumber       int    `json:"seasonNumber"`
	EpisodeNumber      int    `json:"episodeNumber"`
	Title              string `json:"title"`
	Overview           string `json:"overview,omitempty"`
	HasFile            bool   `json:"hasFile"`
	Monitored          bool   `json:"monitored"`
	AirDate            string `json:"airDate,omitempty"`
	AirDateUtc         string `json:"airDateUtc,omitempty"`
}

type EpisodeFile struct {
	ID           int        `json:"id"`
	SeriesID     int        `json:"seriesId"`
	SeasonNumber int        `json:"seasonNumber"`
	RelativePath string     `json:"relativePath,omitempty"`
	Path         string     `json:"path,omitempty"`
	Size         int64      `json:"size"`
	DateAdded    string     `json:"dateAdded,omitempty"`
	Quality      *Quality   `json:"quality,omitempty"`
	MediaInfo    *MediaInfo `json:"mediaInfo,omitempty"`
	Languages    []Language `json:"languages,omitempty"`
}

type Image struct {
	CoverType string `json:"coverType"`
	RemoteURL string `json:"remoteUrl,omitempty"`
	URL       string `json:"url,omitempty"`
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
	Version  int  `json:"version"`
	Real     int  `json:"real"`
	IsRepack bool `json:"isRepack"`
}

type Language struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
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
		return nil, fmt.Errorf("Sonarr request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read Sonarr response: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("Sonarr returned status %d: %s", resp.StatusCode, string(respBody))
	}

	return respBody, nil
}

func (c *Client) GetStatus() (*SystemStatus, error) {
	data, err := c.doRequest("GET", "/system/status", nil)
	if err != nil {
		return nil, err
	}
	var status SystemStatus
	if err := json.Unmarshal(data, &status); err != nil {
		return nil, err
	}
	return &status, nil
}

func (c *Client) GetSeries() ([]Series, error) {
	data, err := c.doRequest("GET", "/series", nil)
	if err != nil {
		return nil, err
	}
	var series []Series
	if err := json.Unmarshal(data, &series); err != nil {
		return nil, err
	}
	return series, nil
}

func (c *Client) GetSeriesByID(id int) (*Series, error) {
	data, err := c.doRequest("GET", fmt.Sprintf("/series/%d", id), nil)
	if err != nil {
		return nil, err
	}
	var s Series
	if err := json.Unmarshal(data, &s); err != nil {
		return nil, err
	}
	return &s, nil
}

func (c *Client) GetEpisodes(seriesID int) ([]Episode, error) {
	data, err := c.doRequest("GET", fmt.Sprintf("/episode?seriesId=%d", seriesID), nil)
	if err != nil {
		return nil, err
	}
	var episodes []Episode
	if err := json.Unmarshal(data, &episodes); err != nil {
		return nil, err
	}
	return episodes, nil
}

func (c *Client) GetEpisodeFiles(seriesID int) ([]EpisodeFile, error) {
	data, err := c.doRequest("GET", fmt.Sprintf("/episodefile?seriesId=%d", seriesID), nil)
	if err != nil {
		return nil, err
	}
	var files []EpisodeFile
	if err := json.Unmarshal(data, &files); err != nil {
		return nil, err
	}
	return files, nil
}

func (c *Client) GetQualityProfiles() ([]QualityProfile, error) {
	data, err := c.doRequest("GET", "/qualityprofile", nil)
	if err != nil {
		return nil, err
	}
	var profiles []QualityProfile
	if err := json.Unmarshal(data, &profiles); err != nil {
		return nil, err
	}
	return profiles, nil
}

func (c *Client) GetRootFolders() ([]RootFolder, error) {
	data, err := c.doRequest("GET", "/rootfolder", nil)
	if err != nil {
		return nil, err
	}
	var folders []RootFolder
	if err := json.Unmarshal(data, &folders); err != nil {
		return nil, err
	}
	return folders, nil
}

func (c *Client) GetTags() ([]Tag, error) {
	data, err := c.doRequest("GET", "/tag", nil)
	if err != nil {
		return nil, err
	}
	var tags []Tag
	if err := json.Unmarshal(data, &tags); err != nil {
		return nil, err
	}
	return tags, nil
}

func (c *Client) CreateTag(label string) (*Tag, error) {
	data, err := c.doRequest("POST", "/tag", map[string]string{"label": label})
	if err != nil {
		return nil, err
	}
	var tag Tag
	if err := json.Unmarshal(data, &tag); err != nil {
		return nil, err
	}
	return &tag, nil
}
