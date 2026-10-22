package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"x-ssh/internal/backup"
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
	eventSFTPTask   = "sftp:task"
	eventHostDistro = "host:distro"
)

// unknownHostKeyPrefix marks the error returned when a host has no approved
// fingerprint yet. The rest of the string is "host:port|SHA256:...|key-type";
// the frontend turns it into the first-connect dialog.
const unknownHostKeyPrefix = "UNKNOWN_HOSTKEY|"

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

	a.sftp = sftpx.NewManager(kh, func(v sftpx.TaskView) {
		runtime.EventsEmit(a.ctx, eventSFTPTask, v)
	})

	a.ssh.SetDistroHandler(func(hostID, distro string) {
		if err := a.profile.SetHostDistro(hostID, distro); err != nil {
			return
		}
		runtime.EventsEmit(a.ctx, eventHostDistro, map[string]string{
			"hostId": hostID,
			"distro": distro,
		})
	})
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
	if err := a.ensureHostTrusted(host); err != nil {
		return sshx.Info{}, err
	}

	info, err := a.ssh.Open(paramsFor(host), cols, rows)
	if err != nil {
		return info, err
	}
	_ = a.profile.TouchHost(hostID)
	return info, nil
}

// ensureHostTrusted checks that the host key was approved before a real
// session is opened.
//
// The handshake has a deadline, so it cannot wait for a human: an unapproved
// host yields a marker error describing the key, the UI asks the user, calls
// TrustHostKey, and retries the open. Nothing is emitted until then, so no
// phantom "connecting" session appears.
func (a *App) ensureHostTrusted(host model.Host) error {
	target, _ := paramsFor(host).Endpoint()
	if _, ok := a.known.Fingerprint(target); ok {
		return nil
	}
	info, err := sshx.ProbeHostKey(paramsFor(host), 10*time.Second)
	if err != nil {
		return err
	}
	return fmt.Errorf("%s%s|%s|%s", unknownHostKeyPrefix, target, info.Fingerprint, info.Algorithm)
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

// SftpOpen starts a file browser session for a saved host.
func (a *App) SftpOpen(hostID string) (string, error) {
	host, err := a.profile.GetHost(hostID)
	if err != nil {
		return "", fmt.Errorf("host not found: %w", err)
	}
	if err := a.ensureHostTrusted(host); err != nil {
		return "", err
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
// the task snapshot immediately; progress and completion arrive as sftp:task
// events.
func (a *App) SftpUpload(sessionID, localPath, remoteDir string) (sftpx.TaskView, error) {
	return a.sftp.Enqueue(sessionID, "upload", filepath.Base(localPath), localPath, remoteDir)
}

// SftpDownload queues a remote file or folder to be saved locally.
func (a *App) SftpDownload(sessionID, remotePath, localDir string) (sftpx.TaskView, error) {
	return a.sftp.Enqueue(sessionID, "download", pathBase(remotePath), remotePath, localDir)
}

// SftpCancelTask stops a queued or running transfer.
func (a *App) SftpCancelTask(sessionID, taskID string) error {
	return a.sftp.CancelTask(sessionID, taskID)
}

// SftpRetryTask re-queues a failed or canceled transfer.
func (a *App) SftpRetryTask(sessionID, taskID string) error {
	return a.sftp.RetryTask(sessionID, taskID)
}

// SftpClearTasks removes finished transfers from the queue. An empty sessionID
// clears all sessions. It returns the removed task ids.
func (a *App) SftpClearTasks(sessionID string) ([]string, error) {
	return a.sftp.ClearTasks(sessionID)
}

// SftpTasks lists a session's transfers in submission order.
func (a *App) SftpTasks(sessionID string) ([]sftpx.TaskView, error) {
	return a.sftp.Tasks(sessionID)
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

// ---------------------------------------------------------------- backup

// exportFileExt is appended by the save dialog so the file is recognisable.
const exportFileExt = ".xsshbackup"

// ExportHosts encrypts the whole profile with the given password and writes it
// to a file the user picks. Empty path means the user cancelled.
func (a *App) ExportHosts(password string) (string, error) {
	text, err := backup.Export(a.profile.Snapshot(), password)
	if err != nil {
		return "", err
	}

	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "导出主机配置",
		DefaultFilename: fmt.Sprintf("x-ssh-%s%s", time.Now().Format("20060102"), exportFileExt),
		Filters: []runtime.FileFilter{
			{DisplayName: "x-ssh 备份", Pattern: "*" + exportFileExt},
		},
	})
	if err != nil || path == "" {
		return "", err
	}
	if !strings.HasSuffix(strings.ToLower(path), exportFileExt) {
		path += exportFileExt
	}
	if err := os.WriteFile(path, []byte(text), 0o600); err != nil {
		return "", fmt.Errorf("write %s: %w", path, err)
	}
	return path, nil
}

// ReadBackupFile opens a picker and returns the chosen backup as text, so the
// import dialog can prefill the same textarea used for pasted content.
func (a *App) ReadBackupFile() (string, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择备份文件",
		Filters: []runtime.FileFilter{
			{DisplayName: "x-ssh 备份", Pattern: "*" + exportFileExt + ";*.json;*.txt"},
			{DisplayName: "所有文件", Pattern: "*"},
		},
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

// ImportHosts decrypts backup text and merges it into the profile. It returns
// what changed so the UI can report it.
func (a *App) ImportHosts(text, password string) (store.ImportSummary, error) {
	p, err := backup.Import(text, password)
	if err != nil {
		return store.ImportSummary{}, err
	}
	return a.profile.MergeImport(p)
}

// ------------------------------------------------------------ known hosts

// ListKnownHosts returns the trusted host fingerprints.
func (a *App) ListKnownHosts() map[string]string {
	return a.known.All()
}

// TrustHostKey pins a fingerprint the user approved in the first-connect
// dialog. The exact fingerprint shown to the user is stored, so a server that
// swaps keys between the probe and the connect is rejected, not trusted.
func (a *App) TrustHostKey(hostport, fingerprint string) error {
	return a.known.Trust(hostport, fingerprint)
}

// ForgetHostKey drops a stored fingerprint so the host is trusted again.
func (a *App) ForgetHostKey(hostport string) error {
	return a.known.Forget(hostport)
}
