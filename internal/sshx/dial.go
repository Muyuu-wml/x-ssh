package sshx

import (
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
)

// Params holds everything needed to open a connection.
type Params struct {
	HostID     string
	Name       string
	Address    string
	Port       int
	Username   string
	AuthType   string // "password" or "key"
	Password   string
	PrivateKey string
	Passphrase string
}

// Endpoint returns the "host:port" dial target and the resolved port.
func (p Params) Endpoint() (string, int) {
	port := p.Port
	if port <= 0 {
		port = 22
	}
	return net.JoinHostPort(p.Address, strconv.Itoa(port)), port
}

// Title returns a short label used for tabs.
func (p Params) Title() string {
	if p.Name != "" {
		return p.Name
	}
	if p.Address != "" {
		return p.Address
	}
	return "session"
}

// Dial opens a raw SSH client connection using the given host key policy.
//
// ssh.Dial only applies its Timeout to the TCP connect; the version exchange,
// key agreement and authentication that follow have no deadline, so a peer that
// accepts the socket and then goes quiet would hang forever. This dials the
// socket itself, bounds the whole handshake, and clears the deadline once the
// connection is up so it does not cut long-lived sessions short.
func Dial(p Params, kh *KnownHosts, timeout time.Duration) (*ssh.Client, error) {
	if p.Address == "" {
		return nil, errors.New("address is required")
	}
	if p.Username == "" {
		return nil, errors.New("username is required")
	}
	if timeout <= 0 {
		timeout = 20 * time.Second
	}

	auths, err := authMethods(p)
	if err != nil {
		return nil, err
	}

	cfg := &ssh.ClientConfig{
		User:            p.Username,
		Auth:            auths,
		HostKeyCallback: kh.Callback(),
	}

	target, _ := p.Endpoint()

	dialer := &net.Dialer{Timeout: timeout}
	conn, err := dialer.Dial("tcp", target)
	if err != nil {
		return nil, friendlyDialError(target, err)
	}
	if err := conn.SetDeadline(time.Now().Add(timeout)); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("set handshake deadline for %s: %w", target, err)
	}

	sshConn, chans, reqs, err := ssh.NewClientConn(conn, target, cfg)
	if err != nil {
		_ = conn.Close()
		return nil, friendlyDialError(target, err)
	}
	// The handshake is done: the deadline must not apply to session traffic.
	if err := conn.SetDeadline(time.Time{}); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("clear handshake deadline for %s: %w", target, err)
	}
	return ssh.NewClient(sshConn, chans, reqs), nil
}

// HostKeyInfo describes the key a server presents.
type HostKeyInfo struct {
	Fingerprint string // SHA256:...
	Algorithm   string // ssh-ed25519, ecdsa-sha2-nistp256, ...
}

// errProbeDone aborts the handshake once the host key has been captured. The
// probe never authenticates, so the server sees no login attempt.
var errProbeDone = errors.New("host key captured")

// ProbeHostKey reads the host key a server presents without logging in.
//
// The first-connect dialog needs the fingerprint before a real session is
// opened: the handshake's deadline cannot wait for a human to read a modal, so
// the key is fetched up front and the actual connection happens after approval.
func ProbeHostKey(p Params, timeout time.Duration) (HostKeyInfo, error) {
	if p.Address == "" {
		return HostKeyInfo{}, errors.New("address is required")
	}
	if timeout <= 0 {
		timeout = 10 * time.Second
	}

	target, _ := p.Endpoint()

	var found HostKeyInfo
	cfg := &ssh.ClientConfig{
		User: "probe",
		HostKeyCallback: func(_ string, _ net.Addr, key ssh.PublicKey) error {
			found = HostKeyInfo{Fingerprint: ssh.FingerprintSHA256(key), Algorithm: key.Type()}
			return errProbeDone
		},
		Timeout: timeout,
	}

	dialer := &net.Dialer{Timeout: timeout}
	conn, err := dialer.Dial("tcp", target)
	if err != nil {
		return HostKeyInfo{}, friendlyDialError(target, err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(timeout))

	if _, _, _, err := ssh.NewClientConn(conn, target, cfg); err != nil {
		if found.Fingerprint != "" {
			return found, nil
		}
		return HostKeyInfo{}, friendlyDialError(target, err)
	}
	return found, errors.New("server accepted the probe without presenting a host key")
}

func authMethods(p Params) ([]ssh.AuthMethod, error) {
	switch p.AuthType {
	case "key":
		if p.PrivateKey == "" {
			return nil, errors.New("no private key configured for this host")
		}
		signer, err := parseSigner(p.PrivateKey, p.Passphrase)
		if err != nil {
			return nil, err
		}
		return []ssh.AuthMethod{ssh.PublicKeys(signer)}, nil

	default:
		if p.Password == "" {
			return nil, errors.New("no password configured for this host")
		}
		return []ssh.AuthMethod{
			ssh.Password(p.Password),
			// Plenty of servers are configured for keyboard-interactive only.
			ssh.KeyboardInteractive(passwordResponder(p.Password)),
		}, nil
	}
}

func passwordResponder(password string) ssh.KeyboardInteractiveChallenge {
	return func(_, _ string, questions []string, echos []bool) ([]string, error) {
		answers := make([]string, len(questions))
		for i := range questions {
			if !echos[i] {
				answers[i] = password
			}
		}
		return answers, nil
	}
}

func parseSigner(pemKey, passphrase string) (ssh.Signer, error) {
	signer, err := ssh.ParsePrivateKey([]byte(pemKey))
	if err == nil {
		return signer, nil
	}

	var missing *ssh.PassphraseMissingError
	if errors.As(err, &missing) {
		if passphrase == "" {
			return nil, errors.New("this private key is passphrase protected, but no passphrase was saved")
		}
		signer, perr := ssh.ParsePrivateKeyWithPassphrase([]byte(pemKey), []byte(passphrase))
		if perr != nil {
			return nil, fmt.Errorf("could not unlock private key: %w", perr)
		}
		return signer, nil
	}
	return nil, fmt.Errorf("could not read private key: %w", err)
}

// friendlyDialError turns raw network and handshake failures into something a
// user can act on.
func friendlyDialError(target string, err error) error {
	msg := err.Error()

	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return fmt.Errorf("connection to %s timed out", target)
	}
	if strings.Contains(msg, "i/o timeout") || strings.Contains(msg, "deadline exceeded") {
		return fmt.Errorf("connection to %s timed out", target)
	}
	if strings.Contains(msg, "connection refused") {
		return fmt.Errorf("%s refused the connection: is an SSH server listening on that port?", target)
	}
	if strings.Contains(msg, "unable to authenticate") || strings.Contains(msg, "no supported methods remain") {
		return fmt.Errorf("%s rejected the credentials: check the username, password or key", target)
	}
	if strings.Contains(msg, "connection reset by peer") {
		return fmt.Errorf("%s reset the connection during the handshake", target)
	}
	if strings.Contains(msg, "no such host") {
		return fmt.Errorf("cannot resolve host %q", target)
	}
	if strings.Contains(msg, "host key for") {
		return err // already actionable
	}
	return fmt.Errorf("cannot connect to %s: %w", target, err)
}
