package sshx

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"sync"

	"golang.org/x/crypto/ssh"
)

// KnownHosts implements pinned host key verification.
//
// A key is only recorded after the user has approved it (see Trust), and every
// later connection must present that same key. This is the behaviour of
// OpenSSH with StrictHostKeyChecking=yes, with the approval step driven by the
// first-connect dialog instead of the terminal.
type KnownHosts struct {
	mu      sync.Mutex
	path    string
	entries map[string]string // "host:port" -> "SHA256:..."
}

// LoadKnownHosts reads the fingerprint database, creating it lazily on save.
func LoadKnownHosts(path string) (*KnownHosts, error) {
	k := &KnownHosts{path: path, entries: map[string]string{}}
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return k, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read known hosts: %w", err)
	}
	if err := json.Unmarshal(raw, &k.entries); err != nil {
		return nil, fmt.Errorf("parse known hosts %s: %w", path, err)
	}
	return k, nil
}

// Callback returns the ssh.HostKeyCallback wired into every dial.
func (k *KnownHosts) Callback() ssh.HostKeyCallback {
	return func(hostname string, _ net.Addr, key ssh.PublicKey) error {
		fp := ssh.FingerprintSHA256(key)

		k.mu.Lock()
		defer k.mu.Unlock()

		known, seen := k.entries[hostname]
		if seen {
			if known == fp {
				return nil
			}
			return fmt.Errorf(
				"host key for %s has changed\n  expected %s\n  received %s\n"+
					"If the server was rebuilt on purpose, remove the saved key in Settings and reconnect",
				hostname, known, fp,
			)
		}
		// Unknown hosts are approved by the user in the app first; reaching
		// this point means the check was bypassed or the entry was forgotten
		// mid-connect, so refuse instead of silently trusting.
		return fmt.Errorf("host key for %s is not trusted yet", hostname)
	}
}

// Trust pins a fingerprint the user approved. It replaces any previous entry so
// a deliberately rebuilt server can be re-approved from the dialog.
func (k *KnownHosts) Trust(hostport, fingerprint string) error {
	if hostport == "" || fingerprint == "" {
		return errors.New("host and fingerprint are required")
	}

	k.mu.Lock()
	defer k.mu.Unlock()

	// Persist first, then publish: a failed write must not leave the new
	// fingerprint in memory, where a later connection would match against a
	// value that was never saved.
	next := k.copyLocked()
	next[hostport] = fingerprint
	if err := k.saveLocked(next); err != nil {
		return err
	}
	k.entries = next
	return nil
}

// Fingerprint returns the stored fingerprint for hostport, if any.
func (k *KnownHosts) Fingerprint(hostport string) (string, bool) {
	k.mu.Lock()
	defer k.mu.Unlock()
	fp, ok := k.entries[hostport]
	return fp, ok
}

// All returns a copy of the fingerprint database.
func (k *KnownHosts) All() map[string]string {
	k.mu.Lock()
	defer k.mu.Unlock()
	out := make(map[string]string, len(k.entries))
	for hp, fp := range k.entries {
		out[hp] = fp
	}
	return out
}

// Forget drops a stored fingerprint so the next connection re-trusts the host.
func (k *KnownHosts) Forget(hostport string) error {
	k.mu.Lock()
	defer k.mu.Unlock()

	next := k.copyLocked()
	delete(next, hostport)
	if err := k.saveLocked(next); err != nil {
		return err
	}
	k.entries = next
	return nil
}

// copyLocked returns a shallow copy of the entry map. Callers must hold the lock.
func (k *KnownHosts) copyLocked() map[string]string {
	out := make(map[string]string, len(k.entries))
	for hp, fp := range k.entries {
		out[hp] = fp
	}
	return out
}

func (k *KnownHosts) saveLocked(entries map[string]string) error {
	data, err := json.MarshalIndent(entries, "", "  ")
	if err != nil {
		return fmt.Errorf("encode known hosts: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(k.path), 0o700); err != nil {
		return fmt.Errorf("create data dir: %w", err)
	}
	tmp := k.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return fmt.Errorf("write known hosts: %w", err)
	}
	return os.Rename(tmp, k.path)
}
