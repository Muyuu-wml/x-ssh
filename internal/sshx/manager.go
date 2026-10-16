package sshx

import (
	"errors"
	"sync"
	"time"

	"github.com/google/uuid"
)

// ErrNoSession is returned when an operation targets an unknown session.
var ErrNoSession = errors.New("session not found")

// ErrClosed is returned when a new session is requested after shutdown.
var ErrClosed = errors.New("session manager is closed")

// Info is the JSON friendly description of a live session sent to the UI.
type Info struct {
	ID      string `json:"id"`
	HostID  string `json:"hostId"`
	Title   string `json:"title"`
	Address string `json:"address"`
	Status  string `json:"status"` // connecting | connected | closed
	Error   string `json:"error,omitempty"`
}

// Manager tracks live sessions so the UI can address them by id.
type Manager struct {
	mu       sync.RWMutex
	kh       *KnownHosts
	sessions map[string]*Session
	closed   bool

	onOpen  func(Info)
	onData  func(sessionID string, data []byte)
	onClose func(sessionID, reason string)
}

// NewManager creates a manager using the supplied host key policy.
func NewManager(kh *KnownHosts) *Manager {
	return &Manager{kh: kh, sessions: map[string]*Session{}}
}

// SetHandlers wires the callbacks used to push state to the UI.
func (m *Manager) SetHandlers(
	onOpen func(Info),
	onData func(sessionID string, data []byte),
	onClose func(sessionID, reason string),
) {
	m.onOpen = onOpen
	m.onData = onData
	m.onClose = onClose
}

// Open dials the host and starts an interactive shell.
//
// The session is registered before its output pump and wait goroutine start, so
// a shell that exits immediately can still be removed from the registry instead
// of being re-added as a stale "connected" entry. "connected" is reported before
// any output can be emitted, which keeps the connected → closed ordering.
func (m *Manager) Open(p Params, cols, rows int) (Info, error) {
	target, _ := p.Endpoint()
	id := uuid.NewString()

	info := Info{
		ID:      id,
		HostID:  p.HostID,
		Title:   p.Title(),
		Address: target,
		Status:  "connecting",
	}
	if m.onOpen != nil {
		m.onOpen(info)
	}

	client, err := Dial(p, m.kh, 20*time.Second)
	if err != nil {
		if m.onClose != nil {
			m.onClose(id, err.Error())
		}
		return Info{ID: id, Status: "closed", Error: err.Error()}, err
	}

	sess, err := Start(client, id, p.HostID, p.Title(), target, cols, rows)
	if err != nil {
		_ = client.Close()
		if m.onClose != nil {
			m.onClose(id, err.Error())
		}
		return Info{ID: id, Status: "closed", Error: err.Error()}, err
	}

	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		_ = sess.Close()
		if m.onClose != nil {
			m.onClose(id, "the application is shutting down")
		}
		return Info{ID: id, Status: "closed", Error: "the application is shutting down"}, ErrClosed
	}
	m.sessions[id] = sess
	m.mu.Unlock()

	info.Status = "connected"
	if m.onOpen != nil {
		m.onOpen(info)
	}

	sess.Run(
		func(data []byte) {
			if m.onData != nil {
				m.onData(id, data)
			}
		},
		func(closeErr error) {
			m.mu.Lock()
			// Remove this exact session; a later one would have a fresh id.
			if cur, ok := m.sessions[id]; ok && cur == sess {
				delete(m.sessions, id)
			}
			m.mu.Unlock()
			reason := ""
			if closeErr != nil {
				reason = closeErr.Error()
			}
			if m.onClose != nil {
				m.onClose(id, reason)
			}
		},
	)
	return info, nil
}

// Get looks up a live session.
func (m *Manager) Get(id string) (*Session, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	s, ok := m.sessions[id]
	if !ok {
		return nil, ErrNoSession
	}
	return s, nil
}

// Write forwards input to a session.
func (m *Manager) Write(id string, data []byte) error {
	s, err := m.Get(id)
	if err != nil {
		return err
	}
	return s.Write(data)
}

// Resize updates the remote PTY size.
func (m *Manager) Resize(id string, cols, rows int) error {
	s, err := m.Get(id)
	if err != nil {
		return err
	}
	return s.Resize(cols, rows)
}

// Close ends a session by id.
func (m *Manager) Close(id string) error {
	s, err := m.Get(id)
	if err != nil {
		return err
	}
	return s.Close()
}

// List returns the live sessions ordered by insertion.
func (m *Manager) List() []Info {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]Info, 0, len(m.sessions))
	for _, s := range m.sessions {
		out = append(out, Info{
			ID:      s.ID,
			HostID:  s.HostID,
			Title:   s.Title,
			Address: s.Address,
			Status:  "connected",
		})
	}
	return out
}

// CloseAll is used on shutdown. After it returns, new sessions are refused.
func (m *Manager) CloseAll() {
	m.mu.Lock()
	m.closed = true
	sessions := make([]*Session, 0, len(m.sessions))
	for _, s := range m.sessions {
		sessions = append(sessions, s)
	}
	m.sessions = map[string]*Session{}
	m.mu.Unlock()

	for _, s := range sessions {
		_ = s.Close()
	}
}
