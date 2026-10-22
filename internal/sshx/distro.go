package sshx

import (
	"bytes"
	"context"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
)

// detectScript prints what identifies the distribution: the os-release
// key/value lines, a separator, then a generic uname fallback for servers that
// have no /etc/os-release.
const detectScript = `cat /etc/os-release 2>/dev/null; echo "@@"; uname -s 2>/dev/null`

// distroAliases maps raw os-release identifiers to the normalized key the
// frontend uses to pick a logo.
var distroAliases = map[string]string{
	"ubuntu":              "ubuntu",
	"debian":              "debian",
	"raspbian":            "debian",
	"centos":              "centos",
	"fedora":              "fedora",
	"arch":                "archlinux",
	"archarm":             "archlinux",
	"manjaro":             "archlinux",
	"alpine":              "alpinelinux",
	"rhel":                "redhat",
	"redhat":              "redhat",
	"ol":                  "redhat",
	"rocky":               "rockylinux",
	"almalinux":           "almalinux",
	"opensuse":            "opensuse",
	"opensuse-leap":       "opensuse",
	"opensuse-tumbleweed": "opensuse",
	"sles":                "opensuse",
	"kali":                "kalilinux",
	"gentoo":              "gentoo",
	"linux":               "linux",
}

// DetectDistro runs a short command over an already authenticated connection and
// returns the remote distribution identifier (os-release ID, normalized). An
// empty string means "could not tell"; callers treat that as "unknown".
func DetectDistro(client *ssh.Client, timeout time.Duration) string {
	if client == nil {
		return ""
	}
	if timeout <= 0 {
		timeout = 10 * time.Second
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	type result struct {
		out []byte
		err error
	}
	done := make(chan result, 1)
	go func() {
		sess, err := client.NewSession()
		if err != nil {
			done <- result{err: err}
			return
		}
		defer sess.Close()
		var buf bytes.Buffer
		sess.Stdout = &buf
		if err := sess.Run(detectScript); err != nil {
			// A non-zero exit still leaves whatever the commands printed.
			if buf.Len() == 0 {
				done <- result{err: err}
				return
			}
		}
		done <- result{out: buf.Bytes()}
	}()

	select {
	case <-ctx.Done():
		return ""
	case r := <-done:
		if r.err != nil {
			return ""
		}
		return parseDistro(r.out)
	}
}

// parseDistro turns the detection output into a normalized identifier.
func parseDistro(out []byte) string {
	text := string(out)
	head, uname, _ := strings.Cut(text, "@@")

	ids := make([]string, 0, 4)
	for _, line := range strings.Split(head, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.Trim(strings.TrimSpace(value), `"'`)
		if key == "ID" || key == "ID_LIKE" {
			for _, part := range strings.Fields(value) {
				ids = append(ids, strings.ToLower(part))
			}
		}
	}

	if d := matchDistro(ids); d != "" {
		return d
	}

	// Unknown Linux family (e.g. a container) still shows a generic logo.
	if strings.Contains(strings.ToLower(uname), "linux") {
		return "linux"
	}
	return ""
}

func matchDistro(ids []string) string {
	for _, id := range ids {
		if d, ok := distroAliases[id]; ok {
			return d
		}
	}
	return ""
}
