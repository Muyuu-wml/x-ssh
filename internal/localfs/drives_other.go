//go:build !windows

package localfs

// Drives keeps the local pane usable when the project is built outside Windows.
func Drives() []string { return []string{Home()} }
