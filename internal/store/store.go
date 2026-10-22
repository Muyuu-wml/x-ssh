// Package store persists the Profile document on disk and owns the encryption
// boundary: secrets are plain in memory and sealed on every write.
//
// Mutations follow commit-on-success: a copy of the profile is modified and
// persisted first, and only replaces the live copy once the write succeeded.
// A failed save therefore leaves both disk and memory unchanged.
package store

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"x-ssh/internal/model"
	"x-ssh/internal/vault"
)

const profileFile = "profile.json"

// ErrNotFound is returned when an entity does not exist.
var ErrNotFound = errors.New("not found")

// Store is a concurrency safe in-memory copy of the profile backed by a file.
type Store struct {
	mu      sync.RWMutex
	dir     string
	path    string
	vault   *vault.Vault
	profile model.Profile
}

// New opens (or creates) the profile inside dir.
func New(dir string, v *vault.Vault) (*Store, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("create data dir: %w", err)
	}
	s := &Store{
		dir:   dir,
		path:  filepath.Join(dir, profileFile),
		vault: v,
		profile: model.Profile{
			Version: model.CurrentProfileVersion,
		},
	}
	if err := s.load(); err != nil {
		return nil, err
	}
	return s, nil
}

// Dir returns the directory holding the profile and app data.
func (s *Store) Dir() string { return s.dir }

// Snapshot returns a deep copy of the profile including decrypted secrets.
func (s *Store) Snapshot() model.Profile {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return cloneProfile(s.profile)
}

// GetHost returns a single host by id.
func (s *Store) GetHost(id string) (model.Host, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, h := range s.profile.Hosts {
		if h.ID == id {
			return h, nil
		}
	}
	return model.Host{}, ErrNotFound
}

// UpsertHost inserts or updates a host, assigning an id and timestamps.
func (s *Store) UpsertHost(in model.Host) (model.Host, error) {
	in.Address = strings.TrimSpace(in.Address)
	in.Name = strings.TrimSpace(in.Name)
	if in.Address == "" {
		return model.Host{}, errors.New("address is required")
	}
	if in.Port <= 0 || in.Port > 65535 {
		in.Port = 22
	}
	if in.AuthType != model.AuthKey {
		in.AuthType = model.AuthPassword
	}
	if in.Tags == nil {
		in.Tags = []string{}
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	next := cloneProfile(s.profile)
	if in.GroupID != "" && groupIndexIn(next, in.GroupID) < 0 {
		return model.Host{}, fmt.Errorf("group %s does not exist", in.GroupID)
	}

	now := time.Now()
	appendToGroup := true
	if in.ID == "" {
		in.ID = uuid.NewString()
		in.CreatedAt = now
	} else {
		idx := hostIndexIn(next, in.ID)
		if idx < 0 {
			return model.Host{}, ErrNotFound
		}
		in.CreatedAt = next.Hosts[idx].CreatedAt
		in.LastUsedAt = next.Hosts[idx].LastUsedAt
		// The editor never sends Distro; a detected value must survive edits.
		if in.Distro == "" {
			in.Distro = next.Hosts[idx].Distro
		}
		if in.GroupID == next.Hosts[idx].GroupID {
			in.Order = next.Hosts[idx].Order
			appendToGroup = false
		}
	}
	if appendToGroup {
		in.Order = 0
		for _, host := range next.Hosts {
			if host.GroupID == in.GroupID && host.Order >= in.Order {
				in.Order = host.Order + 1
			}
		}
	}
	in.UpdatedAt = now

	if idx := hostIndexIn(next, in.ID); idx >= 0 {
		next.Hosts[idx] = in
	} else {
		next.Hosts = append(next.Hosts, in)
	}
	if err := s.saveProfile(next); err != nil {
		return model.Host{}, err
	}
	s.profile = next
	return in, nil
}

// ImportSummary reports what a backup merge changed.
type ImportSummary struct {
	HostsAdded    int `json:"hostsAdded"`
	HostsUpdated  int `json:"hostsUpdated"`
	GroupsAdded   int `json:"groupsAdded"`
	GroupsUpdated int `json:"groupsUpdated"`
}

// MergeImport adds the profile read from a backup into the live profile.
//
// Records are matched by id, so re-importing the same file updates rather than
// duplicates. Unknown ids are appended; secrets come from the backup and replace
// whatever the local host had. The whole merge is validated and saved in one
// commit, so a rejected import leaves the profile exactly as it was.
func (s *Store) MergeImport(in model.Profile) (ImportSummary, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	next := cloneProfile(s.profile)
	var sum ImportSummary

	seenGroups := make(map[string]bool, len(in.Groups))
	for _, g := range in.Groups {
		g.Name = strings.TrimSpace(g.Name)
		if g.Name == "" || (g.ID != "" && seenGroups[g.ID]) {
			continue
		}
		if g.ID == "" {
			g.ID = uuid.NewString()
		}
		seenGroups[g.ID] = true
		if idx := groupIndexIn(next, g.ID); idx >= 0 {
			next.Groups[idx].Name = g.Name
			sum.GroupsUpdated++
		} else {
			g.Order = len(next.Groups)
			next.Groups = append(next.Groups, g)
			sum.GroupsAdded++
		}
	}

	seenHosts := make(map[string]bool, len(in.Hosts))
	for _, h := range in.Hosts {
		h.Address = strings.TrimSpace(h.Address)
		h.Name = strings.TrimSpace(h.Name)
		if h.Address == "" || (h.ID != "" && seenHosts[h.ID]) {
			continue
		}
		if h.ID == "" {
			h.ID = uuid.NewString()
		}
		seenHosts[h.ID] = true
		if h.Port <= 0 || h.Port > 65535 {
			h.Port = 22
		}
		if h.AuthType != model.AuthKey {
			h.AuthType = model.AuthPassword
		}
		if h.Tags == nil {
			h.Tags = []string{}
		}
		h.UpdatedAt = time.Now()

		if idx := hostIndexIn(next, h.ID); idx >= 0 {
			// Keep local bookkeeping the backup should not override.
			h.CreatedAt = next.Hosts[idx].CreatedAt
			h.LastUsedAt = next.Hosts[idx].LastUsedAt
			next.Hosts[idx] = h
			sum.HostsUpdated++
		} else {
			if h.CreatedAt.IsZero() {
				h.CreatedAt = h.UpdatedAt
			}
			h.Order = 0
			for _, host := range next.Hosts {
				if host.GroupID == h.GroupID && host.Order >= h.Order {
					h.Order = host.Order + 1
				}
			}
			next.Hosts = append(next.Hosts, h)
			sum.HostsAdded++
		}
	}

	// Drop group references the import could not satisfy and flatten any cycle,
	// then persist once. A validation failure aborts without touching state.
	if err := normalizeLoaded(&next); err != nil {
		return ImportSummary{}, err
	}
	if err := s.saveProfile(next); err != nil {
		return ImportSummary{}, err
	}
	s.profile = next
	return sum, nil
}

// ReorderHosts stores the complete presentation order within one group.
func (s *Store) ReorderHosts(ids []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(ids) == 0 {
		return errors.New("host order is empty")
	}
	next := cloneProfile(s.profile)
	positions := make(map[string]int, len(ids))
	var groupID string
	for pos, id := range ids {
		idx := hostIndexIn(next, id)
		if idx < 0 {
			return ErrNotFound
		}
		if _, exists := positions[id]; exists {
			return errors.New("duplicate host in order")
		}
		if pos == 0 {
			groupID = next.Hosts[idx].GroupID
		} else if next.Hosts[idx].GroupID != groupID {
			return errors.New("hosts must belong to the same group")
		}
		positions[id] = pos
	}
	for i := range next.Hosts {
		if next.Hosts[i].GroupID != groupID {
			continue
		}
		pos, ok := positions[next.Hosts[i].ID]
		if !ok {
			return errors.New("host order is incomplete; reload the profile")
		}
		next.Hosts[i].Order = pos
	}
	if err := s.saveProfile(next); err != nil {
		return err
	}
	s.profile = next
	return nil
}

// DeleteHost removes a host by id.
func (s *Store) DeleteHost(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	next := cloneProfile(s.profile)
	idx := hostIndexIn(next, id)
	if idx < 0 {
		return ErrNotFound
	}
	next.Hosts = append(next.Hosts[:idx], next.Hosts[idx+1:]...)
	if err := s.saveProfile(next); err != nil {
		return err
	}
	s.profile = next
	return nil
}

// TouchHost records a successful connection.
func (s *Store) TouchHost(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	next := cloneProfile(s.profile)
	idx := hostIndexIn(next, id)
	if idx < 0 {
		return ErrNotFound
	}
	now := time.Now()
	next.Hosts[idx].LastUsedAt = &now
	if err := s.saveProfile(next); err != nil {
		return err
	}
	s.profile = next
	return nil
}

// SetHostDistro records the detected remote OS. It is a no-op when the value
// already matches, so a session opened against an unchanged host does not
// rewrite the profile file on every connect.
func (s *Store) SetHostDistro(id, distro string) error {
	if distro == "" {
		return nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	next := cloneProfile(s.profile)
	idx := hostIndexIn(next, id)
	if idx < 0 {
		return ErrNotFound
	}
	if next.Hosts[idx].Distro == distro {
		return nil
	}
	next.Hosts[idx].Distro = distro
	if err := s.saveProfile(next); err != nil {
		return err
	}
	s.profile = next
	return nil
}

// UpsertGroup inserts or updates a group.
func (s *Store) UpsertGroup(in model.Group) (model.Group, error) {
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		return model.Group{}, errors.New("group name is required")
	}
	if in.ParentID == in.ID && in.ID != "" {
		return model.Group{}, errors.New("a group cannot be its own parent")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	next := cloneProfile(s.profile)
	if in.ID == "" {
		in.ID = uuid.NewString()
	} else if groupIndexIn(next, in.ID) < 0 {
		return model.Group{}, ErrNotFound
	}
	if in.ParentID != "" {
		if groupIndexIn(next, in.ParentID) < 0 {
			return model.Group{}, fmt.Errorf("parent group %s does not exist", in.ParentID)
		}
		if wouldCycle(next, in.ID, in.ParentID) {
			return model.Group{}, errors.New("that parent would create a group cycle")
		}
	}

	if idx := groupIndexIn(next, in.ID); idx >= 0 {
		next.Groups[idx] = in
	} else {
		next.Groups = append(next.Groups, in)
	}
	if err := s.saveProfile(next); err != nil {
		return model.Group{}, err
	}
	s.profile = next
	return in, nil
}

// DeleteGroup removes a group, orphaning its hosts and re-parenting its child
// groups to the deleted group's parent.
func (s *Store) DeleteGroup(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	next := cloneProfile(s.profile)
	idx := groupIndexIn(next, id)
	if idx < 0 {
		return ErrNotFound
	}
	parent := next.Groups[idx].ParentID
	next.Groups = append(next.Groups[:idx], next.Groups[idx+1:]...)
	for i := range next.Groups {
		if next.Groups[i].ParentID == id {
			next.Groups[i].ParentID = parent
		}
	}
	for i := range next.Hosts {
		if next.Hosts[i].GroupID == id {
			next.Hosts[i].GroupID = ""
		}
	}
	if err := s.saveProfile(next); err != nil {
		return err
	}
	s.profile = next
	return nil
}

// ReorderGroups stores presentation order for the sidebar.
func (s *Store) ReorderGroups(ids []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	next := cloneProfile(s.profile)
	pos := make(map[string]int, len(ids))
	for i, id := range ids {
		pos[id] = i
	}
	for i := range next.Groups {
		if p, ok := pos[next.Groups[i].ID]; ok {
			next.Groups[i].Order = p
		}
	}
	sort.SliceStable(next.Groups, func(i, j int) bool {
		return next.Groups[i].Order < next.Groups[j].Order
	})
	if err := s.saveProfile(next); err != nil {
		return err
	}
	s.profile = next
	return nil
}

// ---------------------------------------------------------------- persistence

func (s *Store) load() error {
	raw, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return nil // first run
	}
	if err != nil {
		return fmt.Errorf("read profile: %w", err)
	}

	var p model.Profile
	if err := json.Unmarshal(raw, &p); err != nil {
		return fmt.Errorf("parse profile %s: %w", s.path, err)
	}
	if p.Version == 0 {
		p.Version = model.CurrentProfileVersion
	}
	// Opening a newer document read-only would be safer than guessing, and
	// re-saving it at our version would drop fields we do not understand.
	if p.Version > model.CurrentProfileVersion {
		return fmt.Errorf(
			"profile %s uses version %d, but this build only understands version %d",
			s.path, p.Version, model.CurrentProfileVersion,
		)
	}
	if p.Hosts == nil {
		p.Hosts = []model.Host{}
	}
	if p.Groups == nil {
		p.Groups = []model.Group{}
	}

	if err := normalizeLoaded(&p); err != nil {
		return err
	}

	for i := range p.Hosts {
		for _, f := range []*string{&p.Hosts[i].Password, &p.Hosts[i].PrivateKey, &p.Hosts[i].Passphrase} {
			plain, err := s.vault.Decrypt(*f)
			if err != nil {
				return fmt.Errorf("decrypt secret for host %s: %w", p.Hosts[i].ID, err)
			}
			*f = plain
		}
	}

	s.profile = p
	return nil
}

// normalizeLoaded validates a profile that came from disk. Duplicate identifiers
// are refused (silently keeping one would discard the other); dangling
// references and pre-existing parent cycles are cleared so no record can become
// invisible or make a later parent walk loop forever.
func normalizeLoaded(p *model.Profile) error {
	groups := make(map[string]bool, len(p.Groups))
	for _, g := range p.Groups {
		if g.ID == "" {
			return errors.New("profile contains a group without an id")
		}
		if groups[g.ID] {
			return fmt.Errorf("profile contains duplicate group id %q", g.ID)
		}
		groups[g.ID] = true
	}
	hosts := make(map[string]bool, len(p.Hosts))
	for _, h := range p.Hosts {
		if h.ID == "" {
			return errors.New("profile contains a host without an id")
		}
		if hosts[h.ID] {
			return fmt.Errorf("profile contains duplicate host id %q", h.ID)
		}
		hosts[h.ID] = true
	}

	for i := range p.Groups {
		if p.Groups[i].ParentID == "" {
			continue
		}
		if !groups[p.Groups[i].ParentID] || chainHasCycle(p.Groups, p.Groups[i].ID) {
			p.Groups[i].ParentID = ""
		}
	}
	for i := range p.Hosts {
		if p.Hosts[i].GroupID != "" && !groups[p.Hosts[i].GroupID] {
			p.Hosts[i].GroupID = ""
		}
		if p.Hosts[i].Port <= 0 || p.Hosts[i].Port > 65535 {
			p.Hosts[i].Port = 22
		}
		if p.Hosts[i].AuthType != model.AuthKey {
			p.Hosts[i].AuthType = model.AuthPassword
		}
	}
	return nil
}

// chainHasCycle reports whether walking up from start revisits a group.
func chainHasCycle(groups []model.Group, start string) bool {
	index := make(map[string]int, len(groups))
	for i, g := range groups {
		if _, ok := index[g.ID]; !ok {
			index[g.ID] = i
		}
	}
	visited := make(map[string]bool, len(groups))
	for cur := start; cur != ""; {
		if visited[cur] {
			return true
		}
		visited[cur] = true
		i, ok := index[cur]
		if !ok {
			return false
		}
		cur = groups[i].ParentID
	}
	return false
}

// saveProfile seals the secrets of p and writes it atomically. It never touches
// s.profile, so a failure leaves the live copy untouched.
func (s *Store) saveProfile(p model.Profile) error {
	out := cloneProfile(p)
	out.Version = model.CurrentProfileVersion

	for i := range out.Hosts {
		for _, f := range []*string{&out.Hosts[i].Password, &out.Hosts[i].PrivateKey, &out.Hosts[i].Passphrase} {
			sealed, err := s.vault.Encrypt(*f)
			if err != nil {
				return fmt.Errorf("encrypt secret for host %s: %w", out.Hosts[i].ID, err)
			}
			*f = sealed
		}
	}

	data, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		return fmt.Errorf("encode profile: %w", err)
	}

	// Write to a sibling file then rename so a crash cannot truncate the profile.
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return fmt.Errorf("write profile: %w", err)
	}
	if err := os.Rename(tmp, s.path); err != nil {
		return fmt.Errorf("replace profile: %w", err)
	}
	return nil
}

// ------------------------------------------------------------------- helpers

func hostIndexIn(p model.Profile, id string) int {
	for i := range p.Hosts {
		if p.Hosts[i].ID == id {
			return i
		}
	}
	return -1
}

func groupIndexIn(p model.Profile, id string) int {
	for i := range p.Groups {
		if p.Groups[i].ID == id {
			return i
		}
	}
	return -1
}

// wouldCycle reports whether making childID live under parentID closes a loop.
//
// The visited set is what makes this safe on data loaded from disk: if the
// stored profile already contains a loop that does not include childID, walking
// the parent chain would otherwise never terminate while holding the write lock.
func wouldCycle(p model.Profile, childID, parentID string) bool {
	visited := make(map[string]bool)
	for cur := parentID; cur != ""; {
		if cur == childID {
			return true
		}
		if visited[cur] {
			return true
		}
		visited[cur] = true
		idx := groupIndexIn(p, cur)
		if idx < 0 {
			return false
		}
		cur = p.Groups[idx].ParentID
	}
	return false
}

func cloneProfile(p model.Profile) model.Profile {
	out := model.Profile{Version: p.Version}
	out.Hosts = make([]model.Host, len(p.Hosts))
	copy(out.Hosts, p.Hosts)
	for i := range out.Hosts {
		if p.Hosts[i].Tags != nil {
			out.Hosts[i].Tags = append([]string(nil), p.Hosts[i].Tags...)
		}
		if p.Hosts[i].LastUsedAt != nil {
			t := *p.Hosts[i].LastUsedAt
			out.Hosts[i].LastUsedAt = &t
		}
	}
	out.Groups = make([]model.Group, len(p.Groups))
	copy(out.Groups, p.Groups)
	return out
}
