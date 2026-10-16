//go:build windows

package localfs

import (
	"fmt"
	"sort"

	"golang.org/x/sys/windows"
)

// Drives returns the mounted Windows drive roots that can be browsed.
func Drives() []string {
	mask, err := windows.GetLogicalDrives()
	if err != nil {
		return []string{Home()}
	}

	drives := make([]string, 0, 4)
	for letter := byte('A'); letter <= 'Z'; letter++ {
		if mask&(1<<uint(letter-'A')) != 0 {
			drives = append(drives, fmt.Sprintf("%c:%c", letter, '\\'))
		}
	}
	sort.Strings(drives)
	if len(drives) == 0 {
		return []string{Home()}
	}
	return drives
}
