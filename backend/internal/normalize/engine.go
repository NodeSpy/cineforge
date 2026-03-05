package normalize

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
)

type LoudnessInfo struct {
	InputI       string `json:"input_i"`
	InputTP      string `json:"input_tp"`
	InputLRA     string `json:"input_lra"`
	InputThresh  string `json:"input_thresh"`
	TargetOffset string `json:"target_offset"`
}

type FileProgress struct {
	FilePath string  `json:"file_path"`
	Phase    string  `json:"phase"`
	OutTime  string  `json:"out_time,omitempty"`
	Speed    string  `json:"speed,omitempty"`
	Percent  float64 `json:"percent,omitempty"`
}

type FileResult struct {
	FilePath     string  `json:"file_path"`
	MovieTitle   string  `json:"movie_title"`
	Status       string  `json:"status"`
	MeasuredLUFS float64 `json:"measured_lufs,omitempty"`
	Error        string  `json:"error,omitempty"`
	Duration     float64 `json:"duration,omitempty"`
}

type NormalizeConfig struct {
	TargetLUFS   float64 `json:"target_lufs"`
	HWAccel      string  `json:"hwaccel"`
	AudioBitrate string  `json:"audio_bitrate"`
	Backup       bool    `json:"backup"`
	Parallel     int     `json:"parallel"`
	VideoMode    string  `json:"video_mode"`
	MeasureMode  string  `json:"measure_mode"`
}

func DefaultConfig() NormalizeConfig {
	return NormalizeConfig{
		TargetLUFS:   -16.0,
		HWAccel:      "auto",
		AudioBitrate: "320k",
		Backup:       false,
		Parallel:     1,
		VideoMode:    "copy",
		MeasureMode:  "auto",
	}
}

type ProgressCallback func(FileProgress)
type ResultCallback func(FileResult)

func GetDuration(filePath string) (float64, error) {
	cmd := exec.Command("ffprobe", "-v", "error", "-show_entries", "format=duration",
		"-of", "default=noprint_wrappers=1:nokey=1", "-i", filePath)
	out, err := cmd.Output()
	if err != nil {
		return 0, fmt.Errorf("ffprobe failed: %w", err)
	}
	return strconv.ParseFloat(strings.TrimSpace(string(out)), 64)
}

func HasAudioStream(filePath string) (bool, error) {
	cmd := exec.Command("ffprobe", "-v", "error", "-select_streams", "a",
		"-show_entries", "stream=index", "-of", "csv=p=0", "-i", filePath)
	out, err := cmd.Output()
	if err != nil {
		return false, nil
	}
	return strings.TrimSpace(string(out)) != "", nil
}

func MeasureLoudness(filePath string, targetLUFS float64) (*LoudnessInfo, error) {
	af := fmt.Sprintf("loudnorm=I=%.1f:TP=-1.5:LRA=11:print_format=json", targetLUFS)
	cmd := exec.Command("ffmpeg", "-hide_banner", "-i", filePath,
		"-map", "0:a:0", "-af", af, "-f", "null", "-")

	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("loudness measurement failed: %w\n%s", err, stderr.String())
	}

	output := stderr.String()
	start := strings.LastIndex(output, "{")
	end := strings.LastIndex(output, "}")
	if start == -1 || end == -1 || end <= start {
		return nil, fmt.Errorf("could not find loudnorm JSON in ffmpeg output")
	}

	var info LoudnessInfo
	if err := json.Unmarshal([]byte(output[start:end+1]), &info); err != nil {
		return nil, fmt.Errorf("failed to parse loudnorm JSON: %w", err)
	}
	return &info, nil
}

type MetadataResult struct {
	EstimatedLUFS float64
	MatchesTarget bool
	Found         bool
}

// ReadLoudnessMetadata checks for embedded loudness tags via ffprobe.
// Priority: CINEFORGE_TARGET_LUFS (exact match) > R128_TRACK_GAIN > REPLAYGAIN_TRACK_GAIN.
func ReadLoudnessMetadata(filePath string, targetLUFS float64) MetadataResult {
	cmd := exec.Command("ffprobe", "-v", "error", "-select_streams", "a:0",
		"-show_entries", "stream_tags=CINEFORGE_TARGET_LUFS,CINEFORGE_MEASURED_LUFS,R128_TRACK_GAIN,REPLAYGAIN_TRACK_GAIN",
		"-of", "json", "-i", filePath)
	out, err := cmd.Output()
	if err != nil {
		return MetadataResult{}
	}

	var probe struct {
		Streams []struct {
			Tags map[string]string `json:"tags"`
		} `json:"streams"`
	}
	if err := json.Unmarshal(out, &probe); err != nil || len(probe.Streams) == 0 {
		return MetadataResult{}
	}

	tags := probe.Streams[0].Tags
	if tags == nil {
		return MetadataResult{}
	}

	if cfTarget, ok := tags["CINEFORGE_TARGET_LUFS"]; ok {
		if v, err := strconv.ParseFloat(cfTarget, 64); err == nil {
			matches := math.Abs(v-targetLUFS) < 0.1
			estimatedLUFS := targetLUFS
			if measured, ok := tags["CINEFORGE_MEASURED_LUFS"]; ok {
				if mv, err := strconv.ParseFloat(measured, 64); err == nil {
					estimatedLUFS = mv
				}
			}
			return MetadataResult{EstimatedLUFS: estimatedLUFS, MatchesTarget: matches, Found: true}
		}
	}

	// R128_TRACK_GAIN is in Q7.8 fixed-point format (units of 1/256 dB)
	if r128, ok := tags["R128_TRACK_GAIN"]; ok {
		if v, err := strconv.ParseFloat(strings.TrimSpace(r128), 64); err == nil {
			gainDB := v / 256.0
			estimated := -23.0 - gainDB // R128 reference is -23 LUFS
			return MetadataResult{EstimatedLUFS: estimated, Found: true}
		}
	}

	if rg, ok := tags["REPLAYGAIN_TRACK_GAIN"]; ok {
		cleaned := strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(rg), "dB"))
		if v, err := strconv.ParseFloat(cleaned, 64); err == nil {
			estimated := -18.0 - v // ReplayGain reference is -18 LUFS (approx)
			return MetadataResult{EstimatedLUFS: estimated, Found: true}
		}
	}

	return MetadataResult{}
}

// SampleMeasureLoudness measures ~60 seconds from the middle of the file for a quick LUFS estimate.
func SampleMeasureLoudness(filePath string, targetLUFS float64) (float64, error) {
	duration, err := GetDuration(filePath)
	if err != nil || duration <= 0 {
		return 0, fmt.Errorf("could not determine duration: %w", err)
	}

	sampleDur := 60.0
	if duration < sampleDur {
		sampleDur = duration
	}
	seekPos := (duration - sampleDur) / 2
	if seekPos < 0 {
		seekPos = 0
	}

	af := fmt.Sprintf("loudnorm=I=%.1f:TP=-1.5:LRA=11:print_format=json", targetLUFS)
	cmd := exec.Command("ffmpeg", "-hide_banner",
		"-ss", fmt.Sprintf("%.1f", seekPos), "-t", fmt.Sprintf("%.1f", sampleDur),
		"-i", filePath, "-map", "0:a:0", "-af", af, "-f", "null", "-")

	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return 0, fmt.Errorf("sample measurement failed: %w", err)
	}

	output := stderr.String()
	start := strings.LastIndex(output, "{")
	end := strings.LastIndex(output, "}")
	if start == -1 || end == -1 || end <= start {
		return 0, fmt.Errorf("could not find loudnorm JSON in sample output")
	}

	var info LoudnessInfo
	if err := json.Unmarshal([]byte(output[start:end+1]), &info); err != nil {
		return 0, fmt.Errorf("failed to parse sample loudnorm JSON: %w", err)
	}

	lufs, err := strconv.ParseFloat(info.InputI, 64)
	if err != nil {
		return 0, fmt.Errorf("failed to parse sample input_i: %w", err)
	}
	return lufs, nil
}

func validateLoudnessInfo(info *LoudnessInfo) error {
	fields := map[string]string{
		"input_i":       info.InputI,
		"input_tp":      info.InputTP,
		"input_lra":     info.InputLRA,
		"input_thresh":  info.InputThresh,
		"target_offset": info.TargetOffset,
	}
	for name, val := range fields {
		if _, err := strconv.ParseFloat(val, 64); err != nil {
			return fmt.Errorf("invalid loudness field %s=%q: %w", name, val, err)
		}
	}
	return nil
}

func buildNormalizeArgs(filePath, tempPath string, info *LoudnessInfo, measuredLUFS float64, cfg NormalizeConfig) []string {
	af := fmt.Sprintf(
		"loudnorm=I=%.1f:TP=-1.5:LRA=11:measured_I=%s:measured_TP=%s:measured_LRA=%s:measured_thresh=%s:offset=%s:linear=true",
		cfg.TargetLUFS, info.InputI, info.InputTP, info.InputLRA, info.InputThresh, info.TargetOffset,
	)

	args := []string{"-y", "-progress", "pipe:1", "-hide_banner", "-i", filePath,
		"-map", "0:v", "-map", "0:a:0"}

	if cfg.VideoMode == "copy" {
		args = append(args, "-c:v", "copy")
	} else {
		hwAccel := cfg.HWAccel
		if hwAccel == "auto" {
			hwAccel = DetectHWAccel()
		}
		switch hwAccel {
		case "vaapi":
			args = []string{"-y", "-progress", "pipe:1", "-hide_banner",
				"-vaapi_device", "/dev/dri/renderD128", "-i", filePath,
				"-map", "0:v", "-map", "0:a:0",
				"-vf", "format=nv12,hwupload", "-c:v", "h264_vaapi", "-qp", "23"}
		case "nvenc":
			args = []string{"-y", "-progress", "pipe:1", "-hide_banner",
				"-hwaccel", "cuda", "-i", filePath,
				"-map", "0:v", "-map", "0:a:0",
				"-c:v", "h264_nvenc", "-preset", "p7", "-cq", "23"}
		default:
			args = append(args, "-c:v", "libx264", "-preset", "medium", "-crf", "23")
		}
	}

	args = append(args, "-af", af, "-c:a", "aac", "-b:a", cfg.AudioBitrate,
		"-metadata:s:a:0", fmt.Sprintf("CINEFORGE_TARGET_LUFS=%.1f", cfg.TargetLUFS),
		"-metadata:s:a:0", fmt.Sprintf("CINEFORGE_MEASURED_LUFS=%.1f", measuredLUFS),
		tempPath)
	return args
}

func NormalizeFile(filePath string, cfg NormalizeConfig, duration float64,
	onProgress ProgressCallback, onResult ResultCallback) FileResult {

	movieTitle := strings.TrimSuffix(filepath.Base(filePath), filepath.Ext(filePath))
	result := FileResult{FilePath: filePath, MovieTitle: movieTitle}

	hasAudio, err := HasAudioStream(filePath)
	if err != nil || !hasAudio {
		result.Status = "skipped"
		result.Error = "no audio stream"
		return result
	}

	mode := cfg.MeasureMode
	if mode == "" {
		mode = "full"
	}

	// Pre-screening for "auto" and "sample" modes
	if mode == "auto" || mode == "sample" {
		if onProgress != nil {
			onProgress(FileProgress{FilePath: filePath, Phase: "pre-screening"})
		}

		skipPrescreen := false

		if mode == "auto" {
			meta := ReadLoudnessMetadata(filePath, cfg.TargetLUFS)
			if meta.Found && meta.MatchesTarget {
				log.Printf("[normalize] %s has matching CINEFORGE metadata (target %.1f), skipping", filePath, cfg.TargetLUFS)
				result.MeasuredLUFS = meta.EstimatedLUFS
				result.Status = "done"
				result.Duration = duration
				return result
			}
			if meta.Found {
				log.Printf("[normalize] %s has metadata (estimated %.1f LUFS) but target changed, will re-normalize", filePath, meta.EstimatedLUFS)
			}
		}

		if !skipPrescreen {
			sampleLUFS, sampleErr := SampleMeasureLoudness(filePath, cfg.TargetLUFS)
			if sampleErr == nil {
				result.MeasuredLUFS = sampleLUFS
				if math.Abs(sampleLUFS-cfg.TargetLUFS) <= 0.5 {
					log.Printf("[normalize] %s sample at %.1f LUFS (target %.1f), skipping", filePath, sampleLUFS, cfg.TargetLUFS)
					result.Status = "done"
					result.Duration = duration
					return result
				}
			} else {
				log.Printf("[normalize] %s sample measurement failed, falling back to full: %v", filePath, sampleErr)
			}
		}
	}

	// Full measurement (always reached for "full" mode, fallthrough for others)
	if onProgress != nil {
		onProgress(FileProgress{FilePath: filePath, Phase: "measuring"})
	}

	info, err := MeasureLoudness(filePath, cfg.TargetLUFS)
	if err != nil {
		result.Status = "failed"
		result.Error = err.Error()
		return result
	}

	if err := validateLoudnessInfo(info); err != nil {
		result.Status = "failed"
		result.Error = err.Error()
		return result
	}

	measuredLUFS, _ := strconv.ParseFloat(info.InputI, 64)
	result.MeasuredLUFS = measuredLUFS
	result.Duration = duration

	if math.Abs(measuredLUFS-cfg.TargetLUFS) <= 0.5 {
		log.Printf("[normalize] %s already at %.1f LUFS (target %.1f), skipping re-encode", filePath, measuredLUFS, cfg.TargetLUFS)
		result.Status = "done"
		return result
	}

	dir := filepath.Dir(filePath)
	ext := filepath.Ext(filePath)
	base := strings.TrimSuffix(filepath.Base(filePath), ext)
	tmpFile, err := os.CreateTemp(dir, base+"_norm_*"+ext)
	if err != nil {
		result.Status = "failed"
		result.Error = fmt.Sprintf("failed to create temp file: %v", err)
		return result
	}
	tempPath := tmpFile.Name()
	tmpFile.Close()

	if onProgress != nil {
		onProgress(FileProgress{FilePath: filePath, Phase: "normalizing"})
	}

	args := buildNormalizeArgs(filePath, tempPath, info, measuredLUFS, cfg)
	cmd := exec.Command("ffmpeg", args...)

	var stderrBuf bytes.Buffer
	cmd.Stderr = &stderrBuf
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		result.Status = "failed"
		result.Error = fmt.Sprintf("failed to create stdout pipe: %v", err)
		return result
	}

	if err := cmd.Start(); err != nil {
		result.Status = "failed"
		result.Error = fmt.Sprintf("failed to start ffmpeg: %v", err)
		return result
	}

	if onProgress != nil && duration > 0 {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			line := scanner.Text()
			if strings.HasPrefix(line, "out_time_us=") {
				val := strings.SplitN(line, "=", 2)
				if len(val) == 2 {
					us, _ := strconv.ParseFloat(val[1], 64)
					pct := (us / 1e6 / duration) * 100
					if pct > 100 {
						pct = 100
					}
					onProgress(FileProgress{FilePath: filePath, Phase: "normalizing", Percent: pct})
				}
			} else if strings.HasPrefix(line, "out_time=") {
				val := strings.SplitN(line, "=", 2)
				if len(val) == 2 {
					onProgress(FileProgress{FilePath: filePath, Phase: "normalizing", OutTime: val[1]})
				}
			} else if strings.HasPrefix(line, "speed=") {
				val := strings.SplitN(line, "=", 2)
				if len(val) == 2 {
					onProgress(FileProgress{FilePath: filePath, Phase: "normalizing", Speed: val[1]})
				}
			}
		}
	}

	if err := cmd.Wait(); err != nil {
		os.Remove(tempPath)
		if cfg.VideoMode == "copy" {
			log.Printf("[normalize] -c:v copy failed for %s, retrying with full re-encode", filePath)
			retryCfg := cfg
			retryCfg.VideoMode = "reencode"
			return NormalizeFile(filePath, retryCfg, duration, onProgress, nil)
		}
		result.Status = "failed"
		result.Error = fmt.Sprintf("ffmpeg failed: %v\n%s", err, stderrBuf.String())
		return result
	}

	fi, err := os.Stat(tempPath)
	if err != nil || fi.Size() == 0 {
		os.Remove(tempPath)
		result.Status = "failed"
		result.Error = "output file is empty or missing"
		return result
	}

	if cfg.Backup {
		backupPath := filePath + ".backup"
		if bErr := copyFile(filePath, backupPath); bErr != nil {
			log.Printf("[normalize] Warning: failed to create backup: %v", bErr)
		}
	}

	if err := os.Rename(tempPath, filePath); err != nil {
		os.Remove(tempPath)
		result.Status = "failed"
		result.Error = fmt.Sprintf("failed to replace original: %v", err)
		return result
	}

	result.Status = "done"
	return result
}

func RunJob(files []struct {
	Path     string
	Title    string
	RadarrID int
	TmdbID   int
}, cfg NormalizeConfig, onProgress ProgressCallback, onResult ResultCallback) {

	maxParallel := cfg.Parallel
	if maxParallel < 1 {
		maxParallel = 1
	}

	hwAccel := cfg.HWAccel
	if hwAccel == "auto" {
		hwAccel = DetectHWAccel()
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

	sem := make(chan struct{}, maxParallel)
	var wg sync.WaitGroup

	for _, f := range files {
		wg.Add(1)
		sem <- struct{}{}
		go func(path, title string) {
			defer wg.Done()
			defer func() { <-sem }()
			dur, _ := GetDuration(path)
			result := NormalizeFile(path, cfg, dur, onProgress, onResult)
			result.MovieTitle = title
			if onResult != nil {
				onResult(result)
			}
		}(f.Path, f.Title)
	}

	wg.Wait()
}

func copyFile(src, dst string) error {
	srcFile, err := os.Open(src)
	if err != nil {
		return err
	}
	defer srcFile.Close()

	srcInfo, err := srcFile.Stat()
	if err != nil {
		return err
	}

	dstFile, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, srcInfo.Mode())
	if err != nil {
		return err
	}
	defer dstFile.Close()

	_, err = io.Copy(dstFile, srcFile)
	return err
}
