// Package model defines the persistent data structures of x-ssh.
//
// The data model is intentionally flat compared with a full infrastructure
// platform: a Host belongs to at most one Group, and credentials live inline on
// the Host. This keeps v1 simple while leaving room to introduce reusable
// identities later.
package model

import "time"

// AuthType identifies how a Host authenticates.
type AuthType string

const (
	// AuthPassword authenticates with a password (or keyboard-interactive).
	AuthPassword AuthType = "password"
	// AuthKey authenticates with an SSH private key.
	AuthKey AuthType = "key"
)

// Host is a single remote machine.
//
// Secret fields (Password, PrivateKey, Passphrase) are held in plain text in
// memory and encrypted at rest by the store layer before being written to disk.
type Host struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	GroupID  string   `json:"groupId"`
	Address  string   `json:"address"`
	Port     int      `json:"port"`
	Username string   `json:"username"`
	AuthType AuthType `json:"authType"`
	Order    int      `json:"order"`

	Password   string `json:"password"`
	PrivateKey string `json:"privateKey"`
	Passphrase string `json:"passphrase"`

	Tags []string `json:"tags"`

	// Distro is the remote OS identifier (os-release ID, e.g. "ubuntu"),
	// detected after the first successful connection. Empty until then.
	Distro string `json:"distro,omitempty"`

	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
	LastUsedAt *time.Time `json:"lastUsedAt,omitempty"`
}

// Label returns a human readable identifier used when a name is missing.
func (h Host) Label() string {
	if h.Name != "" {
		return h.Name
	}
	if h.Address != "" {
		return h.Address
	}
	return h.ID
}

// Endpoint returns the "host:port" string used for dialing and host key checks.
func (h Host) Endpoint() (string, int) {
	port := h.Port
	if port <= 0 {
		port = 22
	}
	return h.Address, port
}

// Group is a named collection of Hosts. ParentID allows nesting.
type Group struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	ParentID string `json:"parentId"`
	Order    int    `json:"order"`
}

// Profile is the whole persisted document.
type Profile struct {
	Version int     `json:"version"`
	Groups  []Group `json:"groups"`
	Hosts   []Host  `json:"hosts"`
}

// CurrentProfileVersion is bumped when the on-disk shape changes.
const CurrentProfileVersion = 1

// FileEntry describes one entry in a file browser pane. It is shared by the
// remote (SFTP) and local panes so the UI can render both with one component.
type FileEntry struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	Size    int64  `json:"size"`
	Mode    string `json:"mode"`
	IsDir   bool   `json:"isDir"`
	IsLink  bool   `json:"isLink"`
	ModTime string `json:"modTime"`
	ModUnix int64  `json:"modUnix"`
}
