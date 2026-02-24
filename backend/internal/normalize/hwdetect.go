package normalize

import (
	"os"
	"os/exec"
)

func DetectHWAccel() string {
	if _, err := os.Stat("/dev/dri/renderD128"); err == nil {
		return "vaapi"
	}

	if _, err := exec.LookPath("nvidia-smi"); err == nil {
		cmd := exec.Command("nvidia-smi", "-L")
		if err := cmd.Run(); err == nil {
			return "nvenc"
		}
	}

	return "cpu"
}
