package normalize

import (
	"bytes"
	"os"
	"os/exec"
	"strings"
	"sync"
)

const vaapiDevice = "/dev/dri/renderD128"

// HWAccelMethod describes one hardware acceleration option and whether it is available.
type HWAccelMethod struct {
	Name      string `json:"name"`
	Available bool   `json:"available"`
	Details   string `json:"details"`
	Device    string `json:"device"`
}

// HWAccelStatus is the result of detection: which method "auto" resolves to and per-method availability.
type HWAccelStatus struct {
	Detected string          `json:"detected"`
	Methods  []HWAccelMethod `json:"methods"`
}

var (
	hwDetectOnce sync.Once
	cachedStatus *HWAccelStatus
)

// ResetDetection clears the cached detection result so the next call to DetectAllHWAccel or DetectHWAccel re-probes.
func ResetDetection() {
	hwDetectOnce = sync.Once{}
	cachedStatus = nil
}

func runDetection() {
	cachedStatus = detectAllHWAccel()
}

// DetectAllHWAccel runs hardware acceleration detection (cached after first call) and returns structured results.
func DetectAllHWAccel() HWAccelStatus {
	hwDetectOnce.Do(runDetection)
	return *cachedStatus
}

// DetectHWAccel returns the method name that "auto" would resolve to (vaapi, nvenc, or cpu). Uses cached result.
func DetectHWAccel() string {
	return DetectAllHWAccel().Detected
}

func detectAllHWAccel() *HWAccelStatus {
	status := &HWAccelStatus{
		Methods: []HWAccelMethod{
			{Name: "vaapi", Details: "not detected", Device: ""},
			{Name: "nvenc", Details: "not detected", Device: ""},
			{Name: "cpu", Available: true, Details: "libx264 encoder available", Device: ""},
		},
		Detected: "cpu",
	}

	encoders, encErr := ffmpegEncoders()

	// VAAPI: device exists then vainfo or test encode
	if _, err := os.Stat(vaapiDevice); err == nil {
		vaapiDetails, ok := detectVAAPI()
		if ok {
			status.Methods[0].Available = true
			status.Methods[0].Details = vaapiDetails
			status.Methods[0].Device = vaapiDevice
			status.Detected = "vaapi"
			return status
		}
	}

	// NVENC: ffmpeg has h264_nvenc
	if encErr == nil && strings.Contains(encoders, "h264_nvenc") {
		status.Methods[1].Available = true
		status.Methods[1].Details = "h264_nvenc encoder found"
		if status.Detected == "cpu" {
			status.Detected = "nvenc"
		}
		return status
	}
	if encErr == nil && !strings.Contains(encoders, "h264_nvenc") {
		status.Methods[1].Details = "h264_nvenc encoder not found in ffmpeg"
	}

	return status
}

func ffmpegEncoders() (string, error) {
	cmd := exec.Command("ffmpeg", "-hide_banner", "-encoders")
	var out bytes.Buffer
	cmd.Stdout = &out
	if err := cmd.Run(); err != nil {
		return "", err
	}
	return out.String(), nil
}

func detectVAAPI() (details string, ok bool) {
	if path, err := exec.LookPath("vainfo"); err == nil {
		cmd := exec.Command(path, "--display", "drm", "--device", vaapiDevice)
		var out bytes.Buffer
		cmd.Stdout = &out
		cmd.Stderr = &out
		if err := cmd.Run(); err == nil {
			s := out.String()
			if strings.Contains(s, "VAProfileH264") {
				return "VAProfileH264 detected via vainfo", true
			}
		}
	}

	// Fallback: quick VAAPI encode test (also used when vainfo succeeds but lacks H264)
	cmd := exec.Command("ffmpeg", "-y", "-f", "lavfi", "-i", "nullsrc=s=256x256:d=1",
		"-vaapi_device", vaapiDevice, "-vf", "format=nv12,hwupload", "-c:v", "h264_vaapi", "-f", "null", "-")
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return "VAAPI test encode failed: " + strings.TrimSpace(stderr.String()), false
	}
	return "VAAPI test encode succeeded", true
}

// TestHWAccelMethod runs a quick encode test for the given method ("auto", "vaapi", "nvenc", "cpu").
// Returns true and a success message, or false and an error message. Used to validate HW accel in the UX.
func TestHWAccelMethod(method string) (ok bool, message string) {
	if method == "" || method == "auto" {
		method = DetectHWAccel()
	}
	switch method {
	case "vaapi":
		if _, err := os.Stat(vaapiDevice); err != nil {
			return false, "VAAPI device not found: " + vaapiDevice
		}
		details, okVal := detectVAAPI()
		if okVal {
			return true, "VAAPI encode test passed: " + details
		}
		return false, "VAAPI test failed: " + details
	case "nvenc":
		encoders, err := ffmpegEncoders()
		if err != nil {
			return false, "Could not list ffmpeg encoders"
		}
		if !strings.Contains(encoders, "h264_nvenc") {
			return false, "h264_nvenc encoder not found in ffmpeg"
		}
		cmd := exec.Command("ffmpeg", "-y", "-f", "lavfi", "-i", "nullsrc=s=256x256:d=0.5", "-c:v", "h264_nvenc", "-f", "null", "-")
		var stderr bytes.Buffer
		cmd.Stderr = &stderr
		if err := cmd.Run(); err != nil {
			return false, "NVENC test encode failed: " + strings.TrimSpace(stderr.String())
		}
		return true, "NVENC encode test passed"
	case "cpu":
		encoders, err := ffmpegEncoders()
		if err != nil {
			return false, "Could not list ffmpeg encoders"
		}
		if !strings.Contains(encoders, "libx264") {
			return false, "libx264 encoder not found in ffmpeg"
		}
		cmd := exec.Command("ffmpeg", "-y", "-f", "lavfi", "-i", "nullsrc=s=256x256:d=0.5", "-c:v", "libx264", "-f", "null", "-")
		var stderr bytes.Buffer
		cmd.Stderr = &stderr
		if err := cmd.Run(); err != nil {
			return false, "CPU (libx264) test encode failed: " + strings.TrimSpace(stderr.String())
		}
		return true, "CPU (libx264) encode test passed"
	default:
		return false, "Unknown method: " + method
	}
}
