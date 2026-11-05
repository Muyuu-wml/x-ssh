package sshx

import (
	"errors"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
)

// Stats is one monitoring snapshot of the remote machine.
//
// Sizes are bytes, rates are bytes per second, CPU is a percentage. Samples are
// taken by running a short POSIX shell script over a side channel of the same
// connection the terminal uses, so monitoring never depends on what the user
// has typed into the shell.
type Stats struct {
	Hostname string `json:"hostname"`
	OS       string `json:"os"`
	Kernel   string `json:"kernel"`
	Arch     string `json:"arch"`
	Uptime   int64  `json:"uptime"` // seconds
	CPUs     int    `json:"cpus"`
	Load1    float64 `json:"load1"`
	Load5    float64 `json:"load5"`
	Load15   float64 `json:"load15"`
	CPU      float64 `json:"cpu"` // percent, 0-100

	MemTotal uint64 `json:"memTotal"`
	MemUsed  uint64 `json:"memUsed"`
	MemCache uint64 `json:"memCache"`
	MemFree  uint64 `json:"memFree"`

	SwapTotal uint64 `json:"swapTotal"`
	SwapUsed  uint64 `json:"swapUsed"`

	Disks []DiskUsage `json:"disks"`

	NetRxTotal uint64  `json:"netRxTotal"`
	NetTxTotal uint64  `json:"netTxTotal"`
	NetRxRate  float64 `json:"netRxRate"`
	NetTxRate  float64 `json:"netTxRate"`

	At int64 `json:"at"` // unix milliseconds
}

// DiskUsage is one mounted filesystem with enough room to be worth showing.
type DiskUsage struct {
	Mount string `json:"mount"`
	Total uint64 `json:"total"`
	Used  uint64 `json:"used"`
	Free  uint64 `json:"free"`
}

// statsScript prints labelled sections; the parser below reads them in order.
//
// It sticks to POSIX sh and /proc so it also works on busybox images (Alpine,
// OpenWrt) where bash, nproc and awk variants may be missing.
const statsScript = `
echo "#host"; hostname 2>/dev/null
echo "#os"; ( . /etc/os-release 2>/dev/null; echo "$PRETTY_NAME|$ID" )
echo "#kernel"; uname -sr 2>/dev/null
echo "#arch"; uname -m 2>/dev/null
echo "#up"; cat /proc/uptime 2>/dev/null
echo "#cpu"; head -n 1 /proc/stat 2>/dev/null
echo "#ncpu"; grep -c '^processor' /proc/cpuinfo 2>/dev/null
echo "#load"; cat /proc/loadavg 2>/dev/null
echo "#mem"; grep -E '^(MemTotal|MemFree|MemAvailable|Buffers|Cached|SReclaimable|SwapTotal|SwapFree):' /proc/meminfo 2>/dev/null
echo "#net"; cat /proc/net/dev 2>/dev/null
echo "#disk"; df -P -k 2>/dev/null
`

// rawCounters keeps the previous monotonic counters so CPU load and network
// throughput can be derived from the difference between two samples.
type rawCounters struct {
	at    time.Time
	cpuT  uint64
	cpuI  uint64
	rx    uint64
	tx    uint64
	cpuOK bool
	netOK bool
}

// Sample collects one snapshot. The first call after connect has no previous
// counters, so CPU and network rates read as zero until the second call.
func (s *Session) Sample() (Stats, error) {
	s.mu.Lock()
	client := s.client
	closed := s.closed
	s.mu.Unlock()
	if closed || client == nil {
		return Stats{}, errors.New("session is closed")
	}

	out, err := runCommand(client, statsScript, 6*time.Second)
	if err != nil {
		return Stats{}, err
	}

	st := parseStats(out)

	s.statsMu.Lock()
	prev := s.statsPrev
	cur := rawCounters{at: time.Now(), cpuT: st.cpuT, cpuI: st.cpuI, rx: st.netRx, tx: st.netTx, cpuOK: st.cpuOK, netOK: st.netOK}
	s.statsPrev = &cur
	s.statsMu.Unlock()

	if prev != nil {
		elapsed := cur.at.Sub(prev.at).Seconds()
		if elapsed >= 0.5 {
			if prev.cpuOK && cur.cpuOK {
				dt := float64(cur.cpuT - prev.cpuT)
				di := float64(cur.cpuI - prev.cpuI)
				if dt > 0 {
					st.CPU = clampPercent((dt - di) / dt * 100)
				}
			}
			if prev.netOK && cur.netOK {
				if cur.rx >= prev.rx {
					st.NetRxRate = float64(cur.rx-prev.rx) / elapsed
				}
				if cur.tx >= prev.tx {
					st.NetTxRate = float64(cur.tx-prev.tx) / elapsed
				}
			}
		}
	}

	st.At = time.Now().UnixMilli()
	return st.Stats, nil
}

func clampPercent(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 100 {
		return 100
	}
	return v
}

// parsedStats carries the internal counters alongside the public fields so the
// parser can hand them back without exposing them over JSON.
type parsedStats struct {
	Stats
	cpuT  uint64
	cpuI  uint64
	cpuOK bool
	netRx uint64
	netTx uint64
	netOK bool
}

func parseStats(out []byte) parsedStats {
	var st parsedStats
	section := ""

	mem := map[string]uint64{}
	var diskLines []string

	for _, raw := range strings.Split(string(out), "\n") {
		line := strings.TrimRight(raw, "\r")
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "#") {
			section = strings.TrimPrefix(trimmed, "#")
			continue
		}
		if trimmed == "" {
			continue
		}

		switch section {
		case "host":
			if st.Hostname == "" {
				st.Hostname = trimmed
			}
		case "os":
			name, id, _ := strings.Cut(trimmed, "|")
			st.OS = strings.TrimSpace(strings.Trim(name, `"'`))
			if st.OS == "" {
				st.OS = strings.TrimSpace(id)
			}
		case "kernel":
			st.Kernel = trimmed
		case "arch":
			st.Arch = trimmed
		case "up":
			if fields := strings.Fields(trimmed); len(fields) > 0 {
				if v, err := strconv.ParseFloat(fields[0], 64); err == nil {
					st.Uptime = int64(v)
				}
			}
		case "cpu":
			// cpu user nice system idle iowait irq softirq steal ...
			fields := strings.Fields(trimmed)
			if len(fields) >= 5 {
				var total, idle uint64
				for i, f := range fields[1:] {
					if i >= 8 {
						break // guest/guest_nice are already counted in user/nice
					}
					v, err := strconv.ParseUint(f, 10, 64)
					if err != nil {
						continue
					}
					total += v
					if i == 3 || i == 4 { // idle + iowait
						idle += v
					}
				}
				if total > 0 {
					st.cpuT, st.cpuI, st.cpuOK = total, idle, true
				}
			}
		case "ncpu":
			if v, err := strconv.Atoi(trimmed); err == nil {
				st.CPUs = v
			}
		case "load":
			fields := strings.Fields(trimmed)
			if len(fields) >= 3 {
				st.Load1, _ = strconv.ParseFloat(fields[0], 64)
				st.Load5, _ = strconv.ParseFloat(fields[1], 64)
				st.Load15, _ = strconv.ParseFloat(fields[2], 64)
			}
		case "mem":
			// MemTotal:  16331234 kB
			fields := strings.Fields(trimmed)
			if len(fields) >= 2 {
				key := strings.TrimSuffix(fields[0], ":")
				if v, err := strconv.ParseUint(fields[1], 10, 64); err == nil {
					mem[key] = v * 1024
				}
			}
		case "net":
			if rx, tx, ok := parseNetDev(trimmed); ok {
				st.netRx += rx
				st.netTx += tx
				st.netOK = true
			}
		case "disk":
			diskLines = append(diskLines, trimmed)
		}
	}

	st.NetRxTotal, st.NetTxTotal = st.netRx, st.netTx

	st.MemTotal = mem["MemTotal"]
	st.SwapTotal = mem["SwapTotal"]
	if st.SwapTotal > 0 && st.SwapTotal > mem["SwapFree"] {
		st.SwapUsed = st.SwapTotal - mem["SwapFree"]
	}

	cache := mem["Buffers"] + mem["Cached"] + mem["SReclaimable"]
	st.MemCache = cache
	if total := mem["MemTotal"]; total > 0 {
		avail := mem["MemAvailable"]
		if avail == 0 {
			avail = mem["MemFree"] + cache
		}
		if avail > total {
			avail = total
		}
		st.MemFree = avail
		if used := total - avail; used > 0 {
			st.MemUsed = used
		}
	}

	st.Disks = parseDisk(diskLines)
	return st
}

// parseNetDev sums the counters of real interfaces. Loopback is skipped because
// it says nothing about the link the user cares about.
func parseNetDev(line string) (rx, tx uint64, ok bool) {
	name, rest, found := strings.Cut(line, ":")
	if !found {
		return 0, 0, false
	}
	name = strings.TrimSpace(name)
	if name == "" || name == "lo" || name == "Inter-|" || name == "face" {
		return 0, 0, false
	}
	fields := strings.Fields(rest)
	if len(fields) < 9 {
		return 0, 0, false
	}
	rx, err := strconv.ParseUint(fields[0], 10, 64)
	if err != nil {
		return 0, 0, false
	}
	tx, err = strconv.ParseUint(fields[8], 10, 64)
	if err != nil {
		return 0, 0, false
	}
	return rx, tx, true
}

// parseDisk keeps the mounts a user would recognise: root and data volumes,
// dropping pseudo filesystems and container mount points that only add noise.
func parseDisk(lines []string) []DiskUsage {
	skipMount := func(m string) bool {
		for _, p := range []string{"/dev", "/sys", "/proc", "/run", "/snap", "/boot/efi", "/var/lib/docker", "/var/lib/containers", "/System/Volumes"} {
			if m == p || strings.HasPrefix(m, p+"/") {
				return true
			}
		}
		return m == ""
	}

	out := make([]DiskUsage, 0, 4)
	seen := map[string]bool{}
	for i, line := range lines {
		if i == 0 && strings.HasPrefix(line, "Filesystem") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 6 {
			continue
		}
		mount := strings.Join(fields[5:], " ")
		if skipMount(mount) || seen[mount] {
			continue
		}
		total, err1 := strconv.ParseUint(fields[1], 10, 64)
		used, err2 := strconv.ParseUint(fields[2], 10, 64)
		free, err3 := strconv.ParseUint(fields[3], 10, 64)
		if err1 != nil || err2 != nil || err3 != nil || total == 0 {
			continue
		}
		seen[mount] = true
		out = append(out, DiskUsage{
			Mount: mount,
			Total: total * 1024,
			Used:  used * 1024,
			Free:  free * 1024,
		})
		if len(out) >= 4 {
			break
		}
	}
	return out
}

// runCommand executes a script on a fresh channel of an existing connection.
// The timeout only abandons the wait; the goroutine exits when the remote side
// finishes or the connection dies.
func runCommand(client *ssh.Client, script string, timeout time.Duration) ([]byte, error) {
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
		out, err := sess.CombinedOutput(script)
		done <- result{out: out, err: err}
	}()

	if timeout <= 0 {
		timeout = 6 * time.Second
	}
	select {
	case r := <-done:
		if r.err != nil && len(r.out) == 0 {
			return nil, r.err
		}
		return r.out, nil
	case <-time.After(timeout):
		return nil, errors.New("采样超时")
	}
}
