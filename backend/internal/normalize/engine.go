package normalize

import (
	"bufio"
	"bytes"
	"context"
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
		Parallel:     2,
		VideoMode:    "copy",
		MeasureMode:  "auto",
	}
}

type ProgressCallback func(FileProgress)
type ResultCallback func(FileResult)

// FileProbe holds consolidated probe results from a single ffprobe invocation,
// eliminating redundant subprocess calls for duration, audio presence, and metadata.
type FileProbe struct {
	Duration    float64
	HasAudio    bool
	Metadata    MetadataResult
	probeError  error
}

// ProbeFile runs a single ffprobe call to extract duration, audio stream presence,
// and loudness metadata tags. This replaces separate GetDuration + HasAudioStream +
// ReadLoudnessMetadata calls that each spawned their own subprocess.
func ProbeFile(filePath string, targetLUFS float64) FileProbe {
	cmd := exec.Command("ffprobe", "-v", "error",
		"-show_entries", "format=duration",
		"-show_entries", "stream=index,codec_type",
		"-show_entries", "stream_tags=CINEFORGE_TARGET_LUFS,CINEFORGE_MEASURED_LUFS,R128_TRACK_GAIN,REPLAYGAIN_TRACK_GAIN",
		"-of", "json", "-i", filePath)
	out, err := cmd.Output()
	if err != nil {
		return FileProbe{probeError: fmt.Errorf("ffprobe failed: %w", err)}
	}

	var probe struct {
		Format struct {
			Duration string `json:"duration"`
		} `json:"format"`
		Streams []struct {
			Index     int               `json:"index"`
			CodecType string            `json:"codec_type"`
			Tags      map[string]string `json:"tags"`
		} `json:"streams"`
	}
	if err := json.Unmarshal(out, &probe); err != nil {
		return FileProbe{probeError: fmt.Errorf("ffprobe parse failed: %w", err)}
	}

	fp := FileProbe{}
	fp.Duration, _ = strconv.ParseFloat(strings.TrimSpace(probe.Format.Duration), 64)

	var firstAudioTags map[string]string
	for _, s := range probe.Streams {
		if s.CodecType == "audio" {
			fp.HasAudio = true
			firstAudioTags = s.Tags
			break
		}
	}

	fp.Metadata = parseMetadataTags(firstAudioTags, targetLUFS)
	return fp
}

func parseMetadataTags(tags map[string]string, targetLUFS float64) MetadataResult {
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

	if r128, ok := tags["R128_TRACK_GAIN"]; ok {
		if v, err := strconv.ParseFloat(strings.TrimSpace(r128), 64); err == nil {
			gainDB := v / 256.0
			estimated := -23.0 - gainDB
			return MetadataResult{EstimatedLUFS: estimated, Found: true}
		}
	}

	if rg, ok := tags["REPLAYGAIN_TRACK_GAIN"]; ok {
		cleaned := strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(rg), "dB"))
		if v, err := strconv.ParseFloat(cleaned, 64); err == nil {
			estimated := -18.0 - v
			return MetadataResult{EstimatedLUFS: estimated, Found: true}
		}
	}

	return MetadataResult{}
}

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

func MeasureLoudness(ctx context.Context, filePath string, targetLUFS float64, duration float64, onProgress ProgressCallback) (*LoudnessInfo, error) {
	af := fmt.Sprintf("loudnorm=I=%.1f:TP=-1.5:LRA=11:print_format=json", targetLUFS)

	args := []string{"-y", "-hide_banner"}
	if onProgress != nil && duration > 0 {
		args = append(args, "-progress", "pipe:1")
	}
	args = append(args, "-i", filePath, "-map", "0:a:0", "-af", af, "-f", "null", "-")

	cmd := exec.CommandContext(ctx, "ffmpeg", args...)

	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to create stdout pipe: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("loudness measurement failed: %w\n%s", err, stderr.String())
	}

	if onProgress != nil && duration > 0 {
		drainProgressPipe(stdout, filePath, "measuring", duration, onProgress)
	} else {
		_, _ = io.Copy(io.Discard, stdout)
	}

	if err := cmd.Wait(); err != nil {
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
// Pass a pre-probed duration to avoid a redundant ffprobe call.
func SampleMeasureLoudness(ctx context.Context, filePath string, targetLUFS float64, duration float64) (float64, error) {
	if duration <= 0 {
		return 0, fmt.Errorf("invalid duration for sample measurement")
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
	cmd := exec.CommandContext(ctx, "ffmpeg", "-hide_banner",
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

	args := []string{"-y", "-progress", "pipe:1", "-hide_banner"}

	if cfg.VideoMode == "copy" {
		// No hwaccel flags needed: video is stream-copied so the GPU has nothing to
		// decode or encode. Adding -hwaccel here only adds startup overhead and can
		// trigger failures on files the GPU decoder doesn't support.
		args = append(args, "-i", filePath,
			"-map", "0", "-map", "-0:d?",
			"-c", "copy",
			"-c:a:0", "aac")
	} else {
		switch cfg.HWAccel {
		case "vaapi":
			// Full GPU pipeline: decode on VAAPI, keep frames in GPU memory,
			// encode with h264_vaapi. No hwupload needed since -hwaccel_output_format
			// vaapi keeps decoded frames on the GPU surface.
			args = append(args,
				"-hwaccel", "vaapi",
				"-hwaccel_device", vaapiDevice,
				"-hwaccel_output_format", "vaapi",
				"-i", filePath,
				"-map", "0", "-map", "-0:d?",
				"-c", "copy",
				"-c:v", "h264_vaapi", "-qp", "23",
				"-c:a:0", "aac")
		case "nvenc":
			// Full GPU pipeline: CUDA decode keeps frames on device, NVENC encodes
			// without CPU-side frame transfer.
			args = append(args,
				"-hwaccel", "cuda",
				"-hwaccel_output_format", "cuda",
				"-i", filePath,
				"-map", "0", "-map", "-0:d?",
				"-c", "copy",
				"-c:v", "h264_nvenc", "-preset", "p7", "-cq", "23",
				"-c:a:0", "aac")
		default:
			args = append(args, "-i", filePath,
				"-map", "0", "-map", "-0:d?",
				"-c", "copy",
				"-c:v", "libx264", "-preset", "medium", "-crf", "23",
				"-c:a:0", "aac")
		}
	}

	args = append(args,
		"-af", af,
		"-b:a:0", cfg.AudioBitrate,
		"-metadata:s:a:0", fmt.Sprintf("CINEFORGE_TARGET_LUFS=%.1f", cfg.TargetLUFS),
		"-metadata:s:a:0", fmt.Sprintf("CINEFORGE_MEASURED_LUFS=%.1f", measuredLUFS),
		tempPath)
	return args
}

// NormalizeFile runs the full normalize pipeline: probe -> prescreen -> measure -> encode.
// The probe step is consolidated into a single ffprobe call. On copy-mode encode failure,
// only the encode step is retried with the already-measured loudness data.
func NormalizeFile(ctx context.Context, filePath string, cfg NormalizeConfig, duration float64,
	onProgress ProgressCallback, onResult ResultCallback) FileResult {

	movieTitle := strings.TrimSuffix(filepath.Base(filePath), filepath.Ext(filePath))
	result := FileResult{FilePath: filePath, MovieTitle: movieTitle}

	// --- Stage 1: Consolidated probe (one ffprobe for duration + audio + metadata) ---
	probe := ProbeFile(filePath, cfg.TargetLUFS)
	if probe.probeError != nil {
		result.Status = "failed"
		result.Error = probe.probeError.Error()
		return result
	}
	if !probe.HasAudio {
		result.Status = "skipped"
		result.Error = "no audio stream"
		return result
	}
	if duration <= 0 {
		duration = probe.Duration
	}
	result.Duration = duration

	mode := cfg.MeasureMode
	if mode == "" {
		mode = "full"
	}

	// --- Stage 2: Pre-screening (metadata check + sample measurement) ---
	if mode == "auto" || mode == "sample" {
		if onProgress != nil {
			onProgress(FileProgress{FilePath: filePath, Phase: "pre-screening"})
		}

		if mode == "auto" && probe.Metadata.Found && probe.Metadata.MatchesTarget {
			log.Printf("[normalize] %s has matching CINEFORGE metadata (target %.1f), skipping", filePath, cfg.TargetLUFS)
			result.MeasuredLUFS = probe.Metadata.EstimatedLUFS
			result.Status = "done"
			return result
		}
		if mode == "auto" && probe.Metadata.Found {
			log.Printf("[normalize] %s has metadata (estimated %.1f LUFS) but target changed, will re-normalize", filePath, probe.Metadata.EstimatedLUFS)
		}

		sampleLUFS, sampleErr := SampleMeasureLoudness(ctx, filePath, cfg.TargetLUFS, duration)
		if sampleErr == nil {
			result.MeasuredLUFS = sampleLUFS
			if math.Abs(sampleLUFS-cfg.TargetLUFS) <= 0.5 {
				log.Printf("[normalize] %s sample at %.1f LUFS (target %.1f), skipping", filePath, sampleLUFS, cfg.TargetLUFS)
				result.Status = "done"
				return result
			}
		} else {
			log.Printf("[normalize] %s sample measurement failed, falling back to full: %v", filePath, sampleErr)
		}
	}

	// --- Stage 3: Full loudness measurement ---
	if onProgress != nil {
		onProgress(FileProgress{FilePath: filePath, Phase: "measuring"})
	}

	info, err := MeasureLoudness(ctx, filePath, cfg.TargetLUFS, duration, onProgress)
	if err != nil {
		if ctx.Err() != nil {
			result.Status = "cancelled"
			return result
		}
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

	if math.Abs(measuredLUFS-cfg.TargetLUFS) <= 0.5 {
		log.Printf("[normalize] %s already at %.1f LUFS (target %.1f), skipping re-encode", filePath, measuredLUFS, cfg.TargetLUFS)
		result.Status = "done"
		return result
	}

	// --- Stage 4: Encode (with copy-mode fallback that reuses measured data) ---
	encodeResult := runEncode(ctx, filePath, info, measuredLUFS, cfg, duration, onProgress)
	if encodeResult.err != nil && cfg.VideoMode == "copy" {
		log.Printf("[normalize] -c:v copy failed for %s, retrying with full re-encode (reusing measured loudness)", filePath)
		retryCfg := cfg
		retryCfg.VideoMode = "reencode"
		encodeResult = runEncode(ctx, filePath, info, measuredLUFS, retryCfg, duration, onProgress)
	}

	if encodeResult.err != nil {
		if ctx.Err() != nil {
			result.Status = "cancelled"
			return result
		}
		result.Status = "failed"
		result.Error = encodeResult.err.Error()
		return result
	}

	if cfg.Backup {
		backupPath := filePath + ".backup"
		if bErr := copyFile(filePath, backupPath); bErr != nil {
			log.Printf("[normalize] Warning: failed to create backup: %v", bErr)
		}
	}

	if err := os.Rename(encodeResult.tempPath, filePath); err != nil {
		os.Remove(encodeResult.tempPath)
		result.Status = "failed"
		result.Error = fmt.Sprintf("failed to replace original: %v", err)
		return result
	}

	result.Status = "done"
	return result
}

type encodeResult struct {
	tempPath string
	err      error
}

// runEncode executes the ffmpeg encode pass, reusing pre-measured loudness data.
// Returns the temp file path on success or an error. Caller is responsible for
// renaming the temp file into place.
func runEncode(ctx context.Context, filePath string, info *LoudnessInfo, measuredLUFS float64,
	cfg NormalizeConfig, duration float64, onProgress ProgressCallback) encodeResult {

	dir := filepath.Dir(filePath)
	ext := filepath.Ext(filePath)
	base := strings.TrimSuffix(filepath.Base(filePath), ext)
	tmpFile, err := os.CreateTemp(dir, base+"_norm_*"+ext)
	if err != nil {
		return encodeResult{err: fmt.Errorf("failed to create temp file: %v", err)}
	}
	tempPath := tmpFile.Name()
	tmpFile.Close()

	if onProgress != nil {
		onProgress(FileProgress{FilePath: filePath, Phase: "normalizing"})
	}

	args := buildNormalizeArgs(filePath, tempPath, info, measuredLUFS, cfg)
	cmd := exec.CommandContext(ctx, "ffmpeg", args...)

	var stderrBuf bytes.Buffer
	cmd.Stderr = &stderrBuf
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		os.Remove(tempPath)
		return encodeResult{err: fmt.Errorf("failed to create stdout pipe: %v", err)}
	}

	if err := cmd.Start(); err != nil {
		os.Remove(tempPath)
		return encodeResult{err: fmt.Errorf("failed to start ffmpeg: %v", err)}
	}

	if onProgress != nil && duration > 0 {
		drainProgressPipe(stdout, filePath, "normalizing", duration, onProgress)
	} else {
		_, _ = io.Copy(io.Discard, stdout)
	}

	if err := cmd.Wait(); err != nil {
		os.Remove(tempPath)
		return encodeResult{err: fmt.Errorf("ffmpeg failed: %v\n%s", err, stderrBuf.String())}
	}

	fi, err := os.Stat(tempPath)
	if err != nil || fi.Size() == 0 {
		os.Remove(tempPath)
		return encodeResult{err: fmt.Errorf("output file is empty or missing")}
	}

	return encodeResult{tempPath: tempPath}
}

// drainProgressPipe reads ffmpeg -progress pipe:1 output and emits coalesced
// progress callbacks. Only emits when percent changes by >= 1% to reduce
// callback frequency and downstream DB/SSE churn.
func drainProgressPipe(stdout io.Reader, filePath, phase string, duration float64, onProgress ProgressCallback) {
	scanner := bufio.NewScanner(stdout)
	var lastPct float64
	var lastSpeed, lastOutTime string
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
				if pct-lastPct >= 1.0 || pct >= 100 {
					onProgress(FileProgress{FilePath: filePath, Phase: phase, Percent: pct, Speed: lastSpeed, OutTime: lastOutTime})
					lastPct = pct
				}
			}
		} else if strings.HasPrefix(line, "out_time=") {
			val := strings.SplitN(line, "=", 2)
			if len(val) == 2 {
				lastOutTime = val[1]
			}
		} else if strings.HasPrefix(line, "speed=") {
			val := strings.SplitN(line, "=", 2)
			if len(val) == 2 {
				lastSpeed = val[1]
			}
		}
	}
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
			result := NormalizeFile(context.Background(), path, cfg, dur, onProgress, onResult)
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
