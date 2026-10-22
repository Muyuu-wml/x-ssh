// Package sftpx provides SFTP file transfer over SSH.
//
// Each browser session owns an independent SSH connection so that a long or
// hung transfer cannot block the interactive terminal tabs.
package sftpx

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"

	"x-ssh/internal/model"
	"x-ssh/internal/sshx"
)

// ErrNoClient is returned when an operation targets an unknown browser session.
var ErrNoClient = errors.New("sftp session not found")

// Progress reports transfer advancement. done and total are bytes; total is -1
// when the size is unknown.
type Progress func(fileName string, done, total int64)

// Client wraps one SFTP connection.
type Client struct {
	ID     string
	HostID string
	Title  string

	ssh   *ssh.Client
	sftp  *sftp.Client
	queue *taskQueue
}

// Manager keeps browser sessions addressable by id.
type Manager struct {
	mu      sync.RWMutex
	kh      *sshx.KnownHosts
	clients map[string]*Client

	onTask func(TaskView)
}

// NewManager creates an SFTP session registry. onTask receives every transfer
// update; it may be nil in tests.
func NewManager(kh *sshx.KnownHosts, onTask func(TaskView)) *Manager {
	return &Manager{kh: kh, clients: map[string]*Client{}, onTask: onTask}
}

// Open dials the host and starts an SFTP subsystem.
func (m *Manager) Open(p sshx.Params) (string, error) {
	client, err := sshx.Dial(p, m.kh, 20*time.Second)
	if err != nil {
		return "", err
	}

	sc, err := sftp.NewClient(client)
	if err != nil {
		_ = client.Close()
		return "", fmt.Errorf("start SFTP subsystem: %w", err)
	}

	id := uuid.NewString()
	c := &Client{ID: id, HostID: p.HostID, Title: p.Title(), ssh: client, sftp: sc}
	c.queue = newTaskQueue(m.notifyTask, func(ctx context.Context, kind, source, target string, progress Progress) error {
		if kind == "upload" {
			return c.Upload(ctx, source, target, progress)
		}
		return c.Download(ctx, source, target, progress)
	})

	m.mu.Lock()
	m.clients[id] = c
	m.mu.Unlock()
	return id, nil
}

func (m *Manager) notifyTask(v TaskView) {
	if m.onTask != nil {
		m.onTask(v)
	}
}

// Get resolves a browser session.
func (m *Manager) Get(id string) (*Client, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	c, ok := m.clients[id]
	if !ok {
		return nil, ErrNoClient
	}
	return c, nil
}

// Enqueue registers a transfer on the session's serial queue and returns its
// initial snapshot. name is the entry the user picked, shown in the UI.
func (m *Manager) Enqueue(sessionID, kind, name, source, target string) (TaskView, error) {
	c, err := m.Get(sessionID)
	if err != nil {
		return TaskView{}, err
	}
	return c.queue.enqueue(sessionID, kind, name, source, target), nil
}

// CancelTask stops a queued or running transfer.
func (m *Manager) CancelTask(sessionID, taskID string) error {
	c, err := m.Get(sessionID)
	if err != nil {
		return err
	}
	return c.queue.cancelTask(taskID)
}

// RetryTask re-queues a failed or canceled transfer.
func (m *Manager) RetryTask(sessionID, taskID string) error {
	c, err := m.Get(sessionID)
	if err != nil {
		return err
	}
	return c.queue.retryTask(taskID)
}

// ClearTasks removes finished transfers. An empty sessionID clears every
// session's finished tasks. It returns the removed task ids so the UI can drop
// them from its list.
func (m *Manager) ClearTasks(sessionID string) ([]string, error) {
	if sessionID != "" {
		c, err := m.Get(sessionID)
		if err != nil {
			return nil, err
		}
		return c.queue.clearFinished(), nil
	}
	m.mu.RLock()
	all := make([]*Client, 0, len(m.clients))
	for _, c := range m.clients {
		all = append(all, c)
	}
	m.mu.RUnlock()
	var removed []string
	for _, c := range all {
		removed = append(removed, c.queue.clearFinished()...)
	}
	return removed, nil
}

// Tasks snapshots a session's transfer list in submission order.
func (m *Manager) Tasks(sessionID string) ([]TaskView, error) {
	c, err := m.Get(sessionID)
	if err != nil {
		return nil, err
	}
	return c.queue.list(), nil
}

// Close ends a browser session.
func (m *Manager) Close(id string) error {
	m.mu.Lock()
	c, ok := m.clients[id]
	if ok {
		delete(m.clients, id)
	}
	m.mu.Unlock()
	if !ok {
		return ErrNoClient
	}
	return c.Close()
}

// CloseAll is used on shutdown.
func (m *Manager) CloseAll() {
	m.mu.Lock()
	all := make([]*Client, 0, len(m.clients))
	for _, c := range m.clients {
		all = append(all, c)
	}
	m.clients = map[string]*Client{}
	m.mu.Unlock()
	for _, c := range all {
		_ = c.Close()
	}
}

// Close shuts the SFTP subsystem and the underlying SSH connection. Pending
// transfers are canceled first so their goroutines do not hang on a dead link.
func (c *Client) Close() error {
	if c.queue != nil {
		c.queue.close()
	}
	if c.sftp != nil {
		_ = c.sftp.Close()
	}
	if c.ssh != nil {
		return c.ssh.Close()
	}
	return nil
}

// WorkDir returns the login directory of the remote account.
func (c *Client) WorkDir() string {
	if wd, err := c.sftp.Getwd(); err == nil && wd != "" {
		return wd
	}
	return "/"
}

// Resolve turns a possibly relative path into an absolute canonical path.
//
// It canonicalises the *whole* path, which means the server may resolve a
// trailing symbolic link into its target. That is the right behaviour for
// browsing (navigating into a link should follow it), but wrong for
// destructive operations. Use ResolveEntry for delete/rename.
func (c *Client) Resolve(p string) string {
	if p == "" {
		return c.WorkDir()
	}
	p = strings.ReplaceAll(p, "\\", "/")
	if !strings.HasPrefix(p, "/") {
		p = path.Join(c.WorkDir(), p)
	}
	if abs, err := c.sftp.RealPath(p); err == nil && abs != "" {
		return abs
	}
	return path.Clean(p)
}

// ResolveEntry canonicalises only the *directory* part of p and keeps the last
// component exactly as the user selected it.
//
// This is what destructive operations must use. OpenSSH's SFTP server implements
// SSH_FXP_REALPATH with sftp_realpath(3), which resolves a trailing symlink into
// its target; resolving "dir/link" would therefore make a subsequent delete or
// rename act on "dir/real-target" instead of on the link itself.
func (c *Client) ResolveEntry(p string) string {
	p = strings.TrimRight(strings.ReplaceAll(p, "\\", "/"), "/")
	if p == "" || p == "/" {
		return c.WorkDir()
	}
	// A bare name has no directory part: anchor it at the login directory.
	if !strings.Contains(p, "/") {
		return path.Join(c.Resolve("."), p)
	}
	name := path.Base(p)
	if name == "." || name == ".." {
		// Not an entry name, so there is no link to protect: canonicalise fully,
		// which is also what the previous behaviour did.
		return c.Resolve(p)
	}
	return path.Join(c.Resolve(path.Dir(p)), name)
}

// List reads one directory.
func (c *Client) List(dir string) ([]model.FileEntry, error) {
	dir = c.Resolve(dir)
	items, err := c.sftp.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", dir, err)
	}
	return toEntries(dir, items), nil
}

func toEntries(dir string, items []os.FileInfo) []model.FileEntry {
	out := make([]model.FileEntry, 0, len(items))
	for _, fi := range items {
		mode := fi.Mode()
		out = append(out, model.FileEntry{
			Name:    fi.Name(),
			Path:    path.Join(dir, fi.Name()),
			Size:    fi.Size(),
			Mode:    mode.String(),
			IsDir:   fi.IsDir(),
			IsLink:  mode&os.ModeSymlink != 0,
			ModTime: fi.ModTime().Format("2006-01-02 15:04:05"),
			ModUnix: fi.ModTime().Unix(),
		})
	}
	sortEntries(out)
	return out
}

func sortEntries(entries []model.FileEntry) {
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].IsDir != entries[j].IsDir {
			return entries[i].IsDir
		}
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})
}

// Mkdir creates a directory, including missing parents.
func (c *Client) Mkdir(dir string) error {
	dir = c.Resolve(dir)
	if err := c.sftp.MkdirAll(dir); err != nil {
		return fmt.Errorf("create %s: %w", dir, err)
	}
	return nil
}

// Remove deletes the entry the user selected, or, when recursive is true, a
// directory tree.
//
// A symbolic link is always removed as a link: its target and the target's
// contents are left untouched. pkg/sftp's RemoveAll is not used because it
// resolves the path with Stat and would therefore descend into a linked
// directory and delete the target's contents.
func (c *Client) Remove(target string, recursive bool) error {
	target = c.ResolveEntry(target)
	fi, err := c.sftp.Lstat(target)
	if err != nil {
		return fmt.Errorf("stat %s: %w", target, err)
	}

	switch removeActionFor(fi.Mode()&os.ModeSymlink != 0, fi.IsDir(), recursive) {
	case actionRemoveLink:
		// unlink(2) semantics: the link goes, whatever it points at stays.
		if err := c.sftp.Remove(target); err != nil {
			return fmt.Errorf("remove link %s: %w", target, err)
		}
	case actionRemoveDir:
		// A plain rmdir only succeeds on empty directories, which is what we want.
		if err := c.sftp.RemoveDirectory(target); err != nil {
			return fmt.Errorf("remove directory %s (must be empty): %w", target, err)
		}
	case actionRemoveTree:
		return c.removeTree(target)
	default:
		if err := c.sftp.Remove(target); err != nil {
			return fmt.Errorf("remove %s: %w", target, err)
		}
	}
	return nil
}

// removeAction describes how a selected entry is deleted.
type removeAction int

const (
	actionRemoveFile removeAction = iota // unlink a plain file
	actionRemoveLink                     // unlink a symbolic link, never its target
	actionRemoveDir                      // rmdir, which only succeeds when empty
	actionRemoveTree                     // recursive delete that does not follow links
)

// removeActionFor is the policy that stops a delete from following a link. It is
// kept separate so the decision table can be tested on every platform, including
// systems where creating a test symlink needs privileges.
func removeActionFor(isLink, isDir, recursive bool) removeAction {
	switch {
	case isLink:
		return actionRemoveLink
	case isDir && recursive:
		return actionRemoveTree
	case isDir:
		return actionRemoveDir
	default:
		return actionRemoveFile
	}
}

// removeTree deletes a directory and everything inside it. Links found inside
// the tree are unlinked rather than followed, so a recursive delete cannot
// escape the selected directory.
func (c *Client) removeTree(dir string) error {
	entries, err := c.sftp.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("read %s: %w", dir, err)
	}
	for _, entry := range entries {
		child := path.Join(dir, entry.Name())
		if entry.Mode()&os.ModeSymlink != 0 {
			if err := c.sftp.Remove(child); err != nil {
				return fmt.Errorf("remove link %s: %w", child, err)
			}
			continue
		}
		if entry.IsDir() {
			if err := c.removeTree(child); err != nil {
				return err
			}
			continue
		}
		if err := c.sftp.Remove(child); err != nil {
			return fmt.Errorf("remove %s: %w", child, err)
		}
	}
	if err := c.sftp.RemoveDirectory(dir); err != nil {
		return fmt.Errorf("remove directory %s: %w", dir, err)
	}
	return nil
}

// Rename moves or renames a remote path.
//
// Both endpoints keep their final component, so moving a symbolic link moves
// the link rather than its target.
func (c *Client) Rename(oldPath, newPath string) error {
	if err := c.sftp.Rename(c.ResolveEntry(oldPath), c.ResolveEntry(newPath)); err != nil {
		return fmt.Errorf("rename: %w", err)
	}
	return nil
}

// Upload copies a local file or directory into remoteDir.
func (c *Client) Upload(ctx context.Context, localPath, remoteDir string, progress Progress) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	fi, err := os.Stat(localPath)
	if err != nil {
		return fmt.Errorf("read %s: %w", localPath, err)
	}
	remoteDir = c.Resolve(remoteDir)

	if !fi.IsDir() {
		return c.uploadFile(ctx, localPath, path.Join(remoteDir, fi.Name()), fi.Size(), progress)
	}

	root := path.Join(remoteDir, fi.Name())
	return filepath.Walk(localPath, func(p string, info os.FileInfo, err error) error {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return ctxErr
		}
		if err != nil {
			// Windows system files such as swapfile.sys can be visible inside a
			// browsed drive but remain locked by the OS. Skip an inaccessible
			// descendant and continue transferring the rest of the folder.
			if p != localPath {
				return nil
			}
			return fmt.Errorf("read %s: %w", p, err)
		}
		rel, err := filepath.Rel(localPath, p)
		if err != nil {
			return err
		}
		remote := path.Join(root, filepath.ToSlash(rel))
		if info.IsDir() {
			return c.sftp.MkdirAll(remote)
		}
		return c.uploadFile(ctx, p, remote, info.Size(), progress)
	})
}

func (c *Client) uploadFile(ctx context.Context, localPath, remotePath string, size int64, progress Progress) error {
	src, err := os.Open(localPath)
	if err != nil {
		return fmt.Errorf("open %s: %w", localPath, err)
	}
	defer src.Close()

	if err := c.sftp.MkdirAll(path.Dir(remotePath)); err != nil {
		return fmt.Errorf("create %s: %w", path.Dir(remotePath), err)
	}

	// Stage into a sibling file: the destination keeps its old contents until
	// the transfer is complete and closed cleanly.
	tmp := tempPath(remotePath)
	dst, err := c.sftp.Create(tmp)
	if err != nil {
		return fmt.Errorf("create %s: %w", tmp, err)
	}

	_, copyErr := copyWithProgress(ctx, dst, src, progress, path.Base(remotePath), size)
	closeErr := dst.Close()
	if copyErr != nil {
		_ = c.sftp.Remove(tmp)
		return copyErr
	}
	if closeErr != nil {
		// A remote error such as ENOSPC often only surfaces on close.
		_ = c.sftp.Remove(tmp)
		return fmt.Errorf("close %s: %w", tmp, closeErr)
	}
	if err := c.publishFile(tmp, remotePath); err != nil {
		_ = c.sftp.Remove(tmp)
		return err
	}
	return nil
}

// tempPath returns a staging path beside the target so the final move stays on
// the same filesystem.
func tempPath(target string) string {
	return fmt.Sprintf("%s.xtmp-%s", target, uuid.NewString()[:8])
}

// publishFile moves a fully written staging file onto its destination.
//
// posix-rename@openssh.com is used when the server offers it, which replaces the
// target atomically. Otherwise a regular target file is removed first; that
// window is not atomic, but the new content is already complete and verified, so
// a failure never leaves a half-written file in place of a good one. A target
// that is a directory is never replaced.
func (c *Client) publishFile(tmp, target string) error {
	if _, ok := c.sftp.HasExtension("posix-rename@openssh.com"); ok {
		if err := c.sftp.PosixRename(tmp, target); err == nil {
			return nil
		}
	}
	if err := c.sftp.Rename(tmp, target); err == nil {
		return nil
	}
	if info, err := c.sftp.Lstat(target); err == nil && info.IsDir() {
		return fmt.Errorf("replace %s: the destination is a directory", target)
	}
	if err := c.sftp.Remove(target); err != nil {
		return fmt.Errorf("replace %s: %w", target, err)
	}
	if err := c.sftp.Rename(tmp, target); err != nil {
		return fmt.Errorf("replace %s: %w", target, err)
	}
	return nil
}

// Download copies a remote file or directory into localDir.
func (c *Client) Download(ctx context.Context, remotePath, localDir string, progress Progress) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	remotePath = c.Resolve(remotePath)
	fi, err := c.sftp.Stat(remotePath)
	if err != nil {
		return fmt.Errorf("stat %s: %w", remotePath, err)
	}

	if !fi.IsDir() {
		return c.downloadFile(ctx, remotePath, filepath.Join(localDir, path.Base(remotePath)), fi.Size(), progress)
	}

	base := path.Base(remotePath)
	root := filepath.Join(localDir, base)
	walker := c.sftp.Walk(remotePath)
	for walker.Step() {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return ctxErr
		}
		if err := walker.Err(); err != nil {
			return err
		}
		rel, err := filepath.Rel(remotePath, walker.Path())
		if err != nil {
			return err
		}
		local := filepath.Join(root, rel)
		// Remote names may contain characters that filepath treats as
		// separators on the local platform (a backslash on Windows, for
		// example). Refuse to write outside the download root rather than
		// silently following the mapped path.
		if !withinDir(root, local) {
			return fmt.Errorf("refusing to write %s outside %s", local, root)
		}
		if walker.Stat().IsDir() {
			if err := os.MkdirAll(local, 0o755); err != nil {
				return err
			}
			continue
		}
		if err := c.downloadFile(ctx, walker.Path(), local, walker.Stat().Size(), progress); err != nil {
			return err
		}
	}
	return nil
}

// withinDir reports whether target is root itself or lives underneath it.
func withinDir(root, target string) bool {
	root = filepath.Clean(root)
	target = filepath.Clean(target)
	if target == root {
		return true
	}
	rel, err := filepath.Rel(root, target)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func (c *Client) downloadFile(ctx context.Context, remotePath, localPath string, size int64, progress Progress) error {
	src, err := c.sftp.Open(remotePath)
	if err != nil {
		return fmt.Errorf("open %s: %w", remotePath, err)
	}
	defer src.Close()

	if err := os.MkdirAll(filepath.Dir(localPath), 0o755); err != nil {
		return err
	}

	// Stage locally as well, so a disk-full or interrupted download cannot
	// truncate an existing local file.
	tmp := tempPath(localPath)
	dst, err := os.Create(tmp)
	if err != nil {
		return fmt.Errorf("create %s: %w", tmp, err)
	}

	_, copyErr := copyWithProgress(ctx, dst, src, progress, path.Base(remotePath), size)
	closeErr := dst.Close()
	if copyErr != nil {
		_ = os.Remove(tmp)
		return copyErr
	}
	if closeErr != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("close %s: %w", tmp, closeErr)
	}
	if err := os.Rename(tmp, localPath); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("replace %s: %w", localPath, err)
	}
	return nil
}

func copyWithProgress(ctx context.Context, dst io.Writer, src io.Reader, progress Progress, name string, total int64) (int64, error) {
	buf := make([]byte, 128*1024)
	var written int64
	lastReport := time.Now()

	for {
		if err := ctx.Err(); err != nil {
			return written, err
		}
		n, readErr := src.Read(buf)
		if n > 0 {
			if _, err := dst.Write(buf[:n]); err != nil {
				return written, err
			}
			written += int64(n)
			// Throttle UI updates so a fast local transfer cannot flood the bridge.
			if progress != nil && time.Since(lastReport) > 80*time.Millisecond {
				progress(name, written, total)
				lastReport = time.Now()
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return written, readErr
		}
	}
	if progress != nil {
		progress(name, written, total)
	}
	return written, nil
}
