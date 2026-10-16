package sshx

import (
	"errors"
	"io"
	"sync"

	"golang.org/x/crypto/ssh"
)

// Session is one interactive shell running over its own SSH connection.
//
// Every session owns a dedicated connection rather than multiplexing over a
// shared one. That keeps tab lifetimes independent: closing one terminal can
// never disturb another, and resizing or a hung channel cannot stall siblings.
type Session struct {
	ID      string
	HostID  string
	Title   string
	Address string

	client   *ssh.Client
	session  *ssh.Session
	stdin    io.WriteCloser
	out      io.Reader
	outClose *io.PipeWriter

	mu     sync.Mutex
	closed bool
}

// Start opens a shell with a PTY. It does not start reading output yet: call Run
// once the session has been registered somewhere its close callback can find it.
func Start(client *ssh.Client, id, hostID, title, address string, cols, rows int) (*Session, error) {
	sess, err := client.NewSession()
	if err != nil {
		return nil, err
	}

	if cols <= 0 {
		cols = 80
	}
	if rows <= 0 {
		rows = 24
	}
	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}
	if err := sess.RequestPty("xterm-256color", rows, cols, modes); err != nil {
		_ = sess.Close()
		return nil, err
	}

	stdin, err := sess.StdinPipe()
	if err != nil {
		_ = sess.Close()
		return nil, err
	}

	// A PTY normally merges stderr into stdout, but wiring both to the same
	// pipe guarantees nothing is lost on servers that keep them separate.
	pr, pw := io.Pipe()
	sess.Stdout = pw
	sess.Stderr = pw

	if err := sess.Shell(); err != nil {
		_ = sess.Close()
		return nil, err
	}

	s := &Session{
		ID:       id,
		HostID:   hostID,
		Title:    title,
		Address:  address,
		client:   client,
		session:  sess,
		stdin:    stdin,
		out:      pr,
		outClose: pw,
	}

	return s, nil
}

// Run begins delivering output to onData and invokes onClose exactly once when
// the session ends for any reason. Callers must register the session before
// calling Run so that onClose can remove it from that registry.
func (s *Session) Run(onData func([]byte), onClose func(error)) {
	go s.pump(onData)
	go s.wait(onClose)
}

func (s *Session) pump(onData func([]byte)) {
	buf := make([]byte, 32*1024)
	for {
		n, err := s.out.Read(buf)
		if n > 0 && onData != nil {
			chunk := make([]byte, n)
			copy(chunk, buf[:n])
			onData(chunk)
		}
		if err != nil {
			return
		}
	}
}

func (s *Session) wait(onClose func(error)) {
	err := s.session.Wait()
	_ = s.outClose.Close()
	_ = s.client.Close()

	// If Close already ran, this session ended because the user asked it to.
	// Recording that here is what stops a deliberate close from being reported
	// to the UI as a failure.
	s.mu.Lock()
	userClosed := s.closed
	s.closed = true
	s.mu.Unlock()

	if userClosed {
		err = nil
	}
	if onClose != nil {
		onClose(err)
	}
}

// Write sends keyboard input to the remote shell.
//
// The lock is released before the write: a peer that stops consuming data can
// block the write indefinitely, and Close needs the same lock to flag a
// deliberate close. Holding it across the network call would make a stuck
// session impossible to close.
func (s *Session) Write(b []byte) error {
	s.mu.Lock()
	if s.closed || s.stdin == nil {
		s.mu.Unlock()
		return errors.New("session is closed")
	}
	stdin := s.stdin
	s.mu.Unlock()

	_, err := stdin.Write(b)
	return err
}

// Resize tells the remote PTY about a new window size.
func (s *Session) Resize(cols, rows int) error {
	s.mu.Lock()
	if s.closed || s.session == nil {
		s.mu.Unlock()
		return nil
	}
	sess := s.session
	s.mu.Unlock()

	if cols <= 0 || rows <= 0 {
		return nil
	}
	return sess.WindowChange(rows, cols)
}

// Close tears the session down. It flags the session as deliberately closed
// first, so the wait goroutine reports a clean exit instead of an error.
func (s *Session) Close() error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	s.closed = true
	s.mu.Unlock()

	if s.session != nil {
		_ = s.session.Close()
	}
	return s.client.Close()
}

// Closed reports whether the session has ended.
func (s *Session) Closed() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.closed
}
