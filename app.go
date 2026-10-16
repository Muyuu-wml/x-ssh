package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"x-ssh/internal/localfs"
	"x-ssh/internal/model"
	"x-ssh/internal/sftpx"
	"x-ssh/internal/sshx"
	"x-ssh/internal/store"
	"x-ssh/internal/vault"
)

// Event names pushed to the frontend.
const (
	eventSSHData    = "ssh:data"
	eventSSHState   = "ssh:state"
	eventSFTPStatus = "sftp:status"
)

// App is the Wails bound API surface. Every exported method becomes callable
// from JavaScript as window.go.main.App.<Method>.
type App struct {
	ctx context.Context

	dir     string
	profile *store.Store
	known   *sshx.KnownHosts
	ssh     *sshx.Manager
	sftp    *sftpx.Manager

	keySource string
}

// NewApp creates the application shell. Heavy initialisation happens in startup.
func NewApp() *App {
	return &App{}
}

// startup wires storage, host key policy and the session managers.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	dir, err := dataDir()
	if err != nil {
		a.fatal("cannot determine the data directory", err)
	}
	a.dir = dir

	v, err := vault.Open(dir)
	if err != nil {
		a.fatal("cannot open the credential vault", err)
	}
	a.keySource = v.KeySource()

	st, err := store.New(dir, v)
	if err != nil {
		a.fatal("cannot open the profile store", err)
	}
	a.profile = st

	kh, err := sshx.LoadKnownHosts(filepath.Join(dir, "known_hosts.json"))
	if err != nil {
		a.fatal("cannot open the known hosts database", err)
	}
	a.known = kh

	a.ssh = sshx.NewManager(kh)
	a.ssh.SetHandlers(
		func(info sshx.Info) { runtime.EventsEmit(a.ctx, eventSSHState, info) },
		func(id string, data []byte) {
			runtime.EventsEmit(a.ctx, eventSSHData, sshData{
				SessionID: id,
				Data:      base64.StdEncoding.EncodeToString(data),
			})
		},
		func(id, reason string) {
			runtime.EventsEmit(a.ctx, eventSSHState, sshx.Info{
				ID:     id,
				Status: "closed",
				Error:  reason,
			})
		},
	)

	a.sftp = sftpx.NewManager(kh)
}

// shutdown releases every connection cleanly.
func (a *App) shutdown(_ context.Context) {
	if a.ssh != nil {
		a.ssh.CloseAll()
	}
	if a.sftp != nil {
		a.sftp.CloseAll()
	}
}

func (a *App) fatal(what string, err error) {
	message := fmt.Sprintf("%s:\n\n%v", what, err)
	if a.ctx != nil {
		runtime.MessageDialog(a.ctx, runtime.MessageDialogOptions{
			Type:    runtime.ErrorDialog,
			Title:   "x-ssh",
			Message: message,
		})
	}
	println(message)
	os.Exit(1)
}

func dataDir() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(base, "x-ssh")
	return dir, os.MkdirAll(dir, 0o700)
}

// ---------------------------------------------------------------- app info

// AppInfo is a small diagnostic payload for the settings screen.
type AppInfo struct {
	Version     string `json:"version"`
	DataDir     string `json:"dataDir"`
	KeySource   string `json:"keySource"`
	ProfilePath string `json:"profilePath"`
}

// GetAppInfo reports where data lives and how secrets are protected.
func (a *App) GetAppInfo() AppInfo {
	return AppInfo{
		Version:     "0.1.0",
		DataDir:     a.dir,
		KeySource:   a.keySource,
		ProfilePath: filepath.Join(a.dir, "profile.json"),
	}
}

// ---------------------------------------------------------------- profile

// GetProfile returns every saved group and host.
func (a *App) GetProfile() model.Profile {
	return a.profile.Snapshot()
}

// SaveHost creates or updates a host and returns the stored record.
func (a *App) SaveHost(h model.Host) (model.Host, error) {
	return a.profile.UpsertHost(h)
}

// DeleteHost removes a host.
func (a *App) DeleteHost(id string) error {
	return a.profile.DeleteHost(id)
}

// ReorderHosts persists the presentation order of hosts within one group.
func (a *App) ReorderHosts(ids []string) error {
	return a.profile.ReorderHosts(ids)
}

// SaveGroup creates or updates a group.
func (a *App) SaveGroup(g model.Group) (model.Group, error) {
	return a.profile.UpsertGroup(g)
}

// DeleteGroup removes a group and re-parents its children.
func (a *App) DeleteGroup(id string) error {
	return a.profile.DeleteGroup(id)
}

// ReorderGroups persists the presentation order chosen by dragging groups.
func (a *App) ReorderGroups(ids []string) error {
	return a.profile.ReorderGroups(ids)
}

// ------------------------------------------------------------------ ssh

// sshData carries one chunk of terminal output to the browser.
type sshData struct {
	SessionID string `json:"sessionId"`
	Data      string `json:"data"` // base64 of raw PTY bytes
}

// OpenSession starts an interactive shell for a saved host.
func (a *App) OpenSession(hostID string, cols, rows int) (sshx.Info, error) {
	host, err := a.profile.GetHost(hostID)
	if err != nil {
		return sshx.Info{}, fmt.Errorf("host not found: %w", err)
	}

	info, err := a.ssh.Open(paramsFor(host), cols, rows)
	if err != nil {
		return info, err
	}
	_ = a.profile.TouchHost(hostID)
	return info, nil
}

// WriteSession forwards keyboard input. data is base64 encoded so that binary
// control sequences survive the JSON bridge intact.
func (a *App) WriteSession(sessionID, data string) error {
	raw, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		return fmt.Errorf("decode input: %w", err)
	}
	return a.ssh.Write(sessionID, raw)
}

// ResizeSession forwards a new terminal size to the remote PTY.
func (a *App) ResizeSession(sessionID string, cols, rows int) error {
	return a.ssh.Resize(sessionID, cols, rows)
}

// CloseSession ends a shell.
func (a *App) CloseSession(sessionID string) error {
	return a.ssh.Close(sessionID)
}

// ListSessions reports the live shells.
func (a *App) ListSessions() []sshx.Info {
	return a.ssh.List()
}

func paramsFor(h model.Host) sshx.Params {
	return sshx.Params{
		HostID:     h.ID,
		Name:       h.Label(),
		Address:    h.Address,
		Port:       h.Port,
		Username:   h.Username,
		AuthType:   string(h.AuthType),
		Password:   h.Password,
		PrivateKey: h.PrivateKey,
		Passphrase: h.Passphrase,
	}
}

// ------------------------------------------------------------------ sftp

// transferResult is emitted when a queued transfer finishes.
type transferResult struct {
	SessionID string `json:"sessionId"`
	Kind      string `json:"kind"` // upload | download
	Name      string `json:"name"`
	OK        bool   `json:"ok"`
	Error     string `json:"error,omitempty"`
}

// progressEvent reports transfer advancement to the UI.
type progressEvent struct {
	SessionID string `json:"sessionId"`
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Done      int64  `json:"done"`
	Total     int64  `json:"total"`
}

// SftpOpen starts a file browser session for a saved host.
func (a *App) SftpOpen(hostID string) (string, error) {
	host, err := a.profile.GetHost(hostID)
	if err != nil {
		return "", fmt.Errorf("host not found: %w", err)
	}
	return a.sftp.Open(paramsFor(host))
}

// SftpHome returns the remote login directory.
func (a *App) SftpHome(sessionID string) (string, error) {
	c, err := a.sftp.Get(sessionID)
	if err != nil {
		return "", err
	}
	return c.WorkDir(), nil
}

// SftpList reads a remote directory.
func (a *App) SftpList(sessionID, path string) ([]model.FileEntry, error) {
	c, err := a.sftp.Get(sessionID)
	if err != nil {
		return nil, err
	}
	return c.List(path)
}

// SftpParent returns the parent of a remote path.
func (a *App) SftpParent(sessionID, path string) (string, error) {
	c, err := a.sftp.Get(sessionID)
	if err != nil {
		return "", err
	}
	resolved := c.Resolve(path)
	parent := strings.TrimSuffix(resolved, "/")
	if idx := strings.LastIndex(parent, "/"); idx > 0 {
		return parent[:idx], nil
	}
	return "/", nil
}

// SftpMkdir creates a remote directory.
func (a *App) SftpMkdir(sessionID, path string) error {
	c, err := a.sftp.Get(sessionID)
	if err != nil {
		return err
	}
	return c.Mkdir(path)
}

// SftpRemove deletes a remote file or directory.
func (a *App) SftpRemove(sessionID, path string, recursive bool) error {
	c, err := a.sftp.Get(sessionID)
	if err != nil {
		return err
	}
	return c.Remove(path, recursive)
}

// SftpRename renames or moves a remote path.
func (a *App) SftpRename(sessionID, oldPath, newPath string) error {
	c, err := a.sftp.Get(sessionID)
	if err != nil {
		return err
	}
	return c.Rename(oldPath, newPath)
}

// SftpUpload queues a local file or folder to be sent to the host. It returns
// immediately; completion arrives via the sftp status event.
func (a *App) SftpUpload(sessionID, localPath, remoteDir string) error {
	c, err := a.sftp.Get(sessionID)
	if err != nil {
		return err
	}
	go func() {
		progress := func(name string, done, total int64) {
			runtime.EventsEmit(a.ctx, eventSFTPStatus, progressEvent{
				SessionID: sessionID, Kind: "upload", Name: name, Done: done, Total: total,
			})
		}
		err := c.Upload(localPath, remoteDir, progress)
		result := transferResult{
			SessionID: sessionID,
			Kind:      "upload",
			Name:      filepath.Base(localPath),
			OK:        err == nil,
		}
		if err != nil {
			result.Error = err.Error()
		}
		runtime.EventsEmit(a.ctx, eventSFTPStatus, result)
	}()
	return nil
}

// SftpDownload queues a remote file or folder to be saved locally.
func (a *App) SftpDownload(sessionID, remotePath, localDir string) error {
	c, err := a.sftp.Get(sessionID)
	if err != nil {
		return err
	}
	go func() {
		progress := func(name string, done, total int64) {
			runtime.EventsEmit(a.ctx, eventSFTPStatus, progressEvent{
				SessionID: sessionID, Kind: "download", Name: name, Done: done, Total: total,
			})
		}
		err := c.Download(remotePath, localDir, progress)
		result := transferResult{
			SessionID: sessionID,
			Kind:      "download",
			Name:      pathBase(remotePath),
			OK:        err == nil,
		}
		if err != nil {
			result.Error = err.Error()
		}
		runtime.EventsEmit(a.ctx, eventSFTPStatus, result)
	}()
	return nil
}

// SftpClose ends a browser session.
func (a *App) SftpClose(sessionID string) error {
	return a.sftp.Close(sessionID)
}

func pathBase(p string) string {
	p = strings.TrimSuffix(strings.ReplaceAll(p, "\\", "/"), "/")
	if idx := strings.LastIndex(p, "/"); idx >= 0 {
		return p[idx+1:]
	}
	return p
}

// ----------------------------------------------------------------- local

// LocalHome returns the local home directory.
func (a *App) LocalHome() string { return localfs.Home() }

// LocalDrives returns the local disk roots available to the file browser.
func (a *App) LocalDrives() []string { return localfs.Drives() }

// LocalList reads a local directory for the left hand pane.
func (a *App) LocalList(path string) ([]model.FileEntry, error) {
	return localfs.List(path)
}

// LocalParent returns the parent of a local path.
func (a *App) LocalParent(path string) string { return localfs.Parent(path) }

// LocalMkdir creates a local directory.
func (a *App) LocalMkdir(path string) error { return localfs.Mkdir(path) }

// LocalRemove deletes a local file or directory.
func (a *App) LocalRemove(path string) error { return localfs.Remove(path) }

// LocalRename renames a local path.
func (a *App) LocalRename(oldPath, newPath string) error {
	return localfs.Rename(oldPath, newPath)
}

// ---------------------------------------------------------------- dialogs

// PickLocalFile opens a native file picker.
func (a *App) PickLocalFile() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择文件",
	})
}

// PickLocalDirectory opens a native folder picker.
func (a *App) PickLocalDirectory() (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title:                "选择文件夹",
		CanCreateDirectories: true,
	})
}

// ImportPrivateKeyFile reads a private key from disk so it can be stored in the
// encrypted profile. The key never has to live on disk unencrypted afterwards.
func (a *App) ImportPrivateKeyFile() (string, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择私钥文件",
		Filters: []runtime.FileFilter{
			{DisplayName: "私钥文件", Pattern: "*.pem;*.key;id_*;*.ppk"},
			{DisplayName: "所有文件", Pattern: "*"},
		},
		DefaultDirectory: filepath.Join(localfs.Home(), ".ssh"),
	})
	if err != nil || path == "" {
		return "", err
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read %s: %w", path, err)
	}
	return string(raw), nil
}

// ------------------------------------------------------------ known hosts

// ListKnownHosts returns the trusted host fingerprints.
func (a *App) ListKnownHosts() map[string]string {
	return a.known.All()
}

// ForgetHostKey drops a stored fingerprint so the host is trusted again.
func (a *App) ForgetHostKey(hostport string) error {
	return a.known.Forget(hostport)
}
