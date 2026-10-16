// Package localfs exposes the local filesystem to the SFTP dual pane.
package localfs

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"x-ssh/internal/model"
)

// Home returns the current user's home directory.
func Home() string {
	if h, err := os.UserHomeDir(); err == nil && h != "" {
		return h
	}
	return "."
}

// Resolve turns a possibly relative path into an absolute one.
func Resolve(p string) string {
	if strings.TrimSpace(p) == "" {
		return Home()
	}
	abs, err := filepath.Abs(p)
	if err != nil {
		return p
	}
	return abs
}

// List reads one directory, returning directories before files.
func List(dir string) ([]model.FileEntry, error) {
	dir = Resolve(dir)
	items, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", dir, err)
	}

	out := make([]model.FileEntry, 0, len(items))
	for _, item := range items {
		info, err := item.Info()
		if err != nil {
			continue // vanished or unreadable; skip rather than fail the listing
		}
		mode := info.Mode()
		out = append(out, model.FileEntry{
			Name:    item.Name(),
			Path:    filepath.Join(dir, item.Name()),
			Size:    info.Size(),
			Mode:    mode.String(),
			IsDir:   item.IsDir(),
			IsLink:  mode&os.ModeSymlink != 0,
			ModTime: info.ModTime().Format("2006-01-02 15:04:05"),
			ModUnix: info.ModTime().Unix(),
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].IsDir != out[j].IsDir {
			return out[i].IsDir
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out, nil
}

// Mkdir creates a local directory including parents.
func Mkdir(dir string) error {
	return os.MkdirAll(Resolve(dir), 0o755)
}

// Remove deletes a local file or directory tree.
func Remove(target string) error {
	return os.RemoveAll(Resolve(target))
}

// Rename moves or renames a local path.
func Rename(oldPath, newPath string) error {
	return os.Rename(Resolve(oldPath), Resolve(newPath))
}

// Parent returns the parent directory, defaulting to the volume root.
func Parent(p string) string {
	parent := filepath.Dir(Resolve(p))
	if parent == "" {
		return Home()
	}
	return parent
}
