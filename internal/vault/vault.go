// Package vault provides at-rest encryption for secrets.
//
// A random 256-bit master key is generated on first run and stored in the OS
// credential manager (Windows Credential Manager, macOS Keychain, Linux Secret
// Service). If no credential manager is available, the key falls back to a
// 0600 file inside the app data directory. Secrets are sealed with AES-256-GCM.
package vault

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/zalando/go-keyring"
)

const (
	encPrefix = "enc:v1:"
	serviceID = "x-ssh"
	accountID = "master-key"
	keyFile   = "master.key"
	// profileFile mirrors store.profileFile; the vault only reads it to decide
	// whether encrypted data already depends on this key.
	profileFile = "profile.json"
	keySize     = 32
)

// ErrKeyUnavailable reports that a master key exists (or may exist) but could
// not be read. The caller must not replace it with a freshly generated one.
var ErrKeyUnavailable = errors.New("master key is unavailable")

// KeyStore persists the master key outside the data directory. The production
// implementation talks to the OS credential manager; tests inject an in-memory
// store so they never touch the real per-user keyring.
type KeyStore interface {
	// Get returns the stored base64 key, or ErrKeyNotFound when there is none.
	Get() (string, error)
	// Set stores the base64 key, replacing any previous value.
	Set(b64 string) error
}

// ErrKeyNotFound reports that no master key has been stored yet.
var ErrKeyNotFound = errors.New("no master key stored")

// keyringStore is the default KeyStore, backed by the OS credential manager.
type keyringStore struct{}

func (keyringStore) Get() (string, error) {
	b64, err := keyring.Get(serviceID, accountID)
	if errors.Is(err, keyring.ErrNotFound) {
		return "", ErrKeyNotFound
	}
	return b64, err
}

func (keyringStore) Set(b64 string) error {
	return keyring.Set(serviceID, accountID, b64)
}

// Vault encrypts and decrypts individual string values.
type Vault struct {
	aead  cipher.AEAD
	keyID string // where the master key was sourced from, for diagnostics
}

// Open loads or creates the master key for the given data directory.
func Open(dataDir string) (*Vault, error) {
	return OpenWithStore(dataDir, keyringStore{})
}

// OpenWithStore is Open with an explicit key store, for tests and for
// alternative credential backends.
func OpenWithStore(dataDir string, store KeyStore) (*Vault, error) {
	key, source, err := obtainKey(dataDir, store)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("init cipher: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("init gcm: %w", err)
	}
	return &Vault{aead: aead, keyID: source}, nil
}

// KeySource reports where the master key was loaded from.
func (v *Vault) KeySource() string { return v.keyID }

// IsEncrypted reports whether s carries the ciphertext marker.
func IsEncrypted(s string) bool { return strings.HasPrefix(s, encPrefix) }

// Encrypt seals a plaintext value. Empty input stays empty so the store never
// writes ciphertext for absent secrets.
func (v *Vault) Encrypt(plain string) (string, error) {
	if plain == "" {
		return "", nil
	}
	nonce := make([]byte, v.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", fmt.Errorf("generate nonce: %w", err)
	}
	sealed := v.aead.Seal(nil, nonce, []byte(plain), nil)
	return encPrefix + base64.StdEncoding.EncodeToString(append(nonce, sealed...)), nil
}

// Decrypt opens a sealed value. Values without the marker are returned as-is so
// that hand-edited files remain readable.
func (v *Vault) Decrypt(stored string) (string, error) {
	if stored == "" {
		return "", nil
	}
	if !IsEncrypted(stored) {
		return stored, nil
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(stored, encPrefix))
	if err != nil {
		return "", fmt.Errorf("decode ciphertext: %w", err)
	}
	ns := v.aead.NonceSize()
	if len(raw) < ns {
		return "", errors.New("ciphertext too short")
	}
	plain, err := v.aead.Open(nil, raw[:ns], raw[ns:], nil)
	if err != nil {
		return "", fmt.Errorf("decrypt: %w", err)
	}
	return string(plain), nil
}

// obtainKey resolves the master key, or creates one on a genuinely fresh
// install.
//
// The important rule is that a key is never *replaced*. If the credential
// manager holds a key that cannot be decoded, if a key file exists but is
// damaged, or if a profile with encrypted secrets is already on disk, a missing
// key is a recoverable situation for the user to resolve — silently minting a
// new key would make the old ciphertext permanent garbage.
func obtainKey(dataDir string, store KeyStore) ([]byte, string, error) {
	path := filepath.Join(dataDir, keyFile)
	var problems []string

	// 1. The credential manager.
	corruptStoreEntry := false
	if b64, err := store.Get(); err == nil && b64 != "" {
		if key, derr := decodeKey(b64); derr == nil {
			return key, "os-keychain", nil
		} else {
			corruptStoreEntry = true
			problems = append(problems, fmt.Sprintf("the credential manager entry is unreadable: %v", derr))
		}
	} else if err != nil && !errors.Is(err, ErrKeyNotFound) {
		// A read failure is not fatal by itself: many Linux desktops have no
		// Secret Service, and the key file is the intended fallback. It does
		// mean we must not treat an empty read as "no key configured".
		problems = append(problems, fmt.Sprintf("the credential manager could not be read: %v", err))
	}

	// 2. The key file.
	keyFileExists := false
	if raw, err := os.ReadFile(path); err == nil {
		keyFileExists = true
		b64 := strings.TrimSpace(string(raw))
		if key, derr := decodeKey(b64); derr == nil {
			// Promote into the credential manager when possible.
			_ = store.Set(b64)
			return key, "keyfile", nil
		} else {
			problems = append(problems, fmt.Sprintf("the key file %s is unreadable: %v", path, derr))
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		keyFileExists = true
		problems = append(problems, fmt.Sprintf("the key file %s could not be read: %v", path, err))
	}

	// 3. Refuse to mint a replacement when any key material may already be in use.
	if keyFileExists || corruptStoreEntry || hasEncryptedProfile(dataDir) {
		detail := "no usable master key was found"
		if len(problems) > 0 {
			detail = strings.Join(problems, "; ")
		}
		return nil, "", fmt.Errorf("%w: refusing to create a new one (%s)", ErrKeyUnavailable, detail)
	}

	// 4. Fresh install: nothing to lose, so create the master key.
	key := make([]byte, keySize)
	if _, err := rand.Read(key); err != nil {
		return nil, "", fmt.Errorf("generate master key: %w", err)
	}
	b64 := base64.StdEncoding.EncodeToString(key)

	if err := store.Set(b64); err == nil {
		return key, "os-keychain", nil
	}
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return nil, "", fmt.Errorf("create data dir: %w", err)
	}
	if err := os.WriteFile(path, []byte(b64), 0o600); err != nil {
		return nil, "", fmt.Errorf("persist master key: %w", err)
	}
	return key, "keyfile", nil
}

// hasEncryptedProfile reports whether the profile in dataDir already contains
// sealed secrets, which means a specific master key is required to read it.
func hasEncryptedProfile(dataDir string) bool {
	raw, err := os.ReadFile(filepath.Join(dataDir, profileFile))
	if err != nil {
		return false
	}
	return bytes.Contains(raw, []byte(encPrefix))
}

func decodeKey(b64 string) ([]byte, error) {
	key, err := base64.StdEncoding.DecodeString(strings.TrimSpace(b64))
	if err != nil {
		return nil, err
	}
	if len(key) != keySize {
		return nil, fmt.Errorf("unexpected master key length %d", len(key))
	}
	return key, nil
}
