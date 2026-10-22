// Package backup exports and restores the profile as a password protected file.
//
// The on-disk profile depends on the machine's master key (OS credential
// manager or a local key file), so profile.json cannot be copied to another
// computer. A backup instead re-encrypts the whole profile — groups and hosts,
// secrets included — under a password the user chooses. Only this package's
// format can read it back.
package backup

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"golang.org/x/crypto/scrypt"

	"x-ssh/internal/model"
)

const (
	// formatID marks a file as an x-ssh backup rather than arbitrary JSON.
	formatID = "x-ssh-backup"
	// formatVersion is bumped when the envelope or payload shape changes.
	formatVersion = 1

	saltSize = 16
	keySize  = 32

	// scrypt cost. N=32768 keeps a desktop import near 100 ms while making an
	// offline guessing attack on the password expensive.
	scryptN = 1 << 15
	scryptR = 8
	scryptP = 1
)

// Errors surfaced to the UI in place of raw crypto failures.
var (
	ErrWrongPassword = errors.New("密码错误，或备份内容已损坏")
	ErrWrongFormat   = errors.New("这不是 x-ssh 的备份内容")
	ErrEmptyPassword = errors.New("请设置一个备份密码")
)

// envelope is the outer JSON document written to disk or copied as text.
type envelope struct {
	Format    string    `json:"format"`
	Version   int       `json:"version"`
	CreatedAt time.Time `json:"createdAt"`
	App       string    `json:"app"`
	KDF       kdfInfo   `json:"kdf"`
	Data      string    `json:"data"` // base64 nonce||ciphertext
}

type kdfInfo struct {
	Name   string `json:"name"`
	Salt   string `json:"salt"`
	N      int    `json:"n"`
	R      int    `json:"r"`
	P      int    `json:"p"`
	KeyLen int    `json:"keyLen"`
}

// payload is what actually gets encrypted.
type payload struct {
	Groups []model.Group `json:"groups"`
	Hosts  []model.Host  `json:"hosts"`
}

// aad binds the ciphertext to this format, so a blob cannot be replayed as
// some other document type.
var aad = []byte("x-ssh-backup:v1")

// Export serialises the profile and seals it with the password. The returned
// text is both the file content and what the UI can show for copying.
func Export(p model.Profile, password string) (string, error) {
	if strings.TrimSpace(password) == "" {
		return "", ErrEmptyPassword
	}

	body, err := json.Marshal(payload{Groups: p.Groups, Hosts: p.Hosts})
	if err != nil {
		return "", fmt.Errorf("encode profile: %w", err)
	}

	salt := make([]byte, saltSize)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("generate salt: %w", err)
	}
	aead, err := newAEAD(password, salt, scryptN, scryptR, scryptP)
	if err != nil {
		return "", err
	}

	nonce := make([]byte, aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", fmt.Errorf("generate nonce: %w", err)
	}
	sealed := aead.Seal(nil, nonce, body, aad)

	env := envelope{
		Format:    formatID,
		Version:   formatVersion,
		CreatedAt: time.Now().UTC(),
		App:       "x-ssh",
		KDF: kdfInfo{
			Name:   "scrypt",
			Salt:   base64.StdEncoding.EncodeToString(salt),
			N:      scryptN,
			R:      scryptR,
			P:      scryptP,
			KeyLen: keySize,
		},
		Data: base64.StdEncoding.EncodeToString(append(nonce, sealed...)),
	}

	out, err := json.MarshalIndent(env, "", "  ")
	if err != nil {
		return "", fmt.Errorf("encode backup: %w", err)
	}
	return string(out), nil
}

// Import opens backup text and returns the profile it contains. The caller
// decides how to merge it; nothing here touches the live profile.
func Import(text, password string) (model.Profile, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return model.Profile{}, ErrWrongFormat
	}
	if strings.TrimSpace(password) == "" {
		return model.Profile{}, ErrEmptyPassword
	}

	var env envelope
	if err := json.Unmarshal([]byte(text), &env); err != nil {
		return model.Profile{}, ErrWrongFormat
	}
	if env.Format != formatID || env.Version > formatVersion || env.KDF.Name != "scrypt" {
		return model.Profile{}, ErrWrongFormat
	}

	salt, err := base64.StdEncoding.DecodeString(env.KDF.Salt)
	if err != nil {
		return model.Profile{}, ErrWrongFormat
	}
	raw, err := base64.StdEncoding.DecodeString(env.Data)
	if err != nil {
		return model.Profile{}, ErrWrongFormat
	}

	aead, err := newAEAD(password, salt, env.KDF.N, env.KDF.R, env.KDF.P)
	if err != nil {
		return model.Profile{}, ErrWrongFormat
	}
	ns := aead.NonceSize()
	if len(raw) < ns {
		return model.Profile{}, ErrWrongFormat
	}
	body, err := aead.Open(nil, raw[:ns], raw[ns:], aad)
	if err != nil {
		// GCM cannot distinguish a wrong password from tampered bytes.
		return model.Profile{}, ErrWrongPassword
	}

	var p payload
	if err := json.Unmarshal(body, &p); err != nil {
		return model.Profile{}, ErrWrongFormat
	}
	return model.Profile{Version: model.CurrentProfileVersion, Groups: p.Groups, Hosts: p.Hosts}, nil
}

func newAEAD(password string, salt []byte, n, r, p int) (cipher.AEAD, error) {
	// The parameters travel with the file, so reject absurd values instead of
	// letting a hand-edited header consume all memory.
	if n < 1<<12 || n > 1<<22 || r < 1 || r > 32 || p < 1 || p > 16 {
		return nil, errors.New("backup has unusable key derivation parameters")
	}
	key, err := scrypt.Key([]byte(password), salt, n, r, p, keySize)
	if err != nil {
		return nil, fmt.Errorf("derive key: %w", err)
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("init cipher: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("init gcm: %w", err)
	}
	return aead, nil
}
