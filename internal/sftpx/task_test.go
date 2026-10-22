package sftpx

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

// collector records every task event so tests can assert on the stream.
type collector struct {
	mu    sync.Mutex
	views []TaskView
}

func (c *collector) add(v TaskView) {
	c.mu.Lock()
	c.views = append(c.views, v)
	c.mu.Unlock()
}

func (c *collector) last(id string) (TaskView, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	var out TaskView
	found := false
	for _, v := range c.views {
		if v.ID == id {
			out = v
			found = true
		}
	}
	return out, found
}

func waitStatus(t *testing.T, c *collector, id, status string) TaskView {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if v, ok := c.last(id); ok && v.Status == status {
			return v
		}
		time.Sleep(5 * time.Millisecond)
	}
	v, _ := c.last(id)
	t.Fatalf("task %s never reached %q (last %q, err %q)", id, status, v.Status, v.Error)
	return TaskView{}
}

func TestQueueRunsSeriallyAndCompletes(t *testing.T) {
	var col collector
	var mu sync.Mutex
	var active, maxActive int

	q := newTaskQueue(col.add, func(ctx context.Context, kind, src, dst string, p Progress) error {
		mu.Lock()
		active++
		if active > maxActive {
			maxActive = active
		}
		mu.Unlock()
		p("f", 5, 10)
		time.Sleep(20 * time.Millisecond)
		mu.Lock()
		active--
		mu.Unlock()
		return nil
	})
	defer q.close()

	a := q.enqueue("s", "upload", "a", "a", "/r")
	b := q.enqueue("s", "download", "b", "b", "/l")
	waitStatus(t, &col, a.ID, StatusDone)
	v := waitStatus(t, &col, b.ID, StatusDone)
	if v.Total != 10 || v.Done != 5 {
		t.Fatalf("progress not reported: %+v", v)
	}
	if maxActive != 1 {
		t.Fatalf("transfers must be serial, saw %d concurrent", maxActive)
	}
}

func TestQueueCancelQueued(t *testing.T) {
	var col collector
	release := make(chan struct{})
	q := newTaskQueue(col.add, func(ctx context.Context, kind, src, dst string, p Progress) error {
		<-release
		return nil
	})
	defer q.close()

	a := q.enqueue("s", "upload", "a", "a", "/r")
	waitStatus(t, &col, a.ID, StatusRunning)
	b := q.enqueue("s", "upload", "b", "b", "/r")

	if err := q.cancelTask(b.ID); err != nil {
		t.Fatal(err)
	}
	waitStatus(t, &col, b.ID, StatusCanceled)
	close(release)
	waitStatus(t, &col, a.ID, StatusDone)
}

func TestQueueCancelRunning(t *testing.T) {
	var col collector
	q := newTaskQueue(col.add, func(ctx context.Context, kind, src, dst string, p Progress) error {
		<-ctx.Done()
		return ctx.Err()
	})
	defer q.close()

	a := q.enqueue("s", "upload", "a", "a", "/r")
	waitStatus(t, &col, a.ID, StatusRunning)
	if err := q.cancelTask(a.ID); err != nil {
		t.Fatal(err)
	}
	v := waitStatus(t, &col, a.ID, StatusCanceled)
	if v.Error != "" {
		t.Fatalf("cancel is not an error: %q", v.Error)
	}
}

func TestQueueRetryAfterFailure(t *testing.T) {
	var col collector
	var calls int
	var mu sync.Mutex
	q := newTaskQueue(col.add, func(ctx context.Context, kind, src, dst string, p Progress) error {
		mu.Lock()
		calls++
		n := calls
		mu.Unlock()
		if n == 1 {
			return errors.New("boom")
		}
		return nil
	})
	defer q.close()

	a := q.enqueue("s", "upload", "a", "a", "/r")
	v := waitStatus(t, &col, a.ID, StatusFailed)
	if v.Error != "boom" {
		t.Fatalf("error not carried: %q", v.Error)
	}
	if err := q.retryTask(a.ID); err != nil {
		t.Fatal(err)
	}
	waitStatus(t, &col, a.ID, StatusDone)
}

func TestQueueClearFinished(t *testing.T) {
	var col collector
	q := newTaskQueue(col.add, func(ctx context.Context, kind, src, dst string, p Progress) error {
		return nil
	})
	defer q.close()

	a := q.enqueue("s", "upload", "a", "a", "/r")
	waitStatus(t, &col, a.ID, StatusDone)
	b := q.enqueue("s", "upload", "b", "b", "/r")
	waitStatus(t, &col, b.ID, StatusDone)

	removed := q.clearFinished()
	if len(removed) != 2 {
		t.Fatalf("expected 2 removed, got %v", removed)
	}
	if got := q.list(); len(got) != 0 {
		t.Fatalf("list not empty: %+v", got)
	}
}

func TestQueueCloseCancelsPending(t *testing.T) {
	var col collector
	q := newTaskQueue(col.add, func(ctx context.Context, kind, src, dst string, p Progress) error {
		<-ctx.Done()
		return ctx.Err()
	})
	a := q.enqueue("s", "upload", "a", "a", "/r")
	waitStatus(t, &col, a.ID, StatusRunning)
	q.close()
	waitStatus(t, &col, a.ID, StatusCanceled)
}
