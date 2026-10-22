package sftpx

import (
	"context"
	"errors"
	"sync"

	"github.com/google/uuid"
)

// Task statuses. A task moves queued → running → done/failed/canceled; retry
// moves failed/canceled back to queued.
const (
	StatusQueued   = "queued"
	StatusRunning  = "running"
	StatusDone     = "done"
	StatusFailed   = "failed"
	StatusCanceled = "canceled"
)

// ErrNoTask is returned when an operation targets an unknown transfer task.
var ErrNoTask = errors.New("transfer task not found")

// TaskView is the JSON snapshot of one transfer pushed to the UI.
type TaskView struct {
	ID        string `json:"id"`
	SessionID string `json:"sessionId"`
	Kind      string `json:"kind"` // upload | download
	Name      string `json:"name"` // what the user selected
	File      string `json:"file"` // file currently transferring
	Status    string `json:"status"`
	Done      int64  `json:"done"`
	Total     int64  `json:"total"` // -1 when unknown
	Error     string `json:"error,omitempty"`
}

// task is the internal mutable record behind a TaskView.
type task struct {
	TaskView
	source   string
	target   string
	cancel   context.CancelFunc // set while running
	ctxStash context.Context    // the running task's context
}

// taskQueue serialises transfers of one browser session. SFTP multiplexes over
// a single channel, so running transfers one at a time is both simpler and no
// slower than racing them.
type taskQueue struct {
	mu     sync.Mutex
	tasks  map[string]*task
	order  []string // insertion order, for stable listings
	wake   chan struct{}
	quit   chan struct{}
	once   sync.Once
	notify func(TaskView)
	run    func(ctx context.Context, kind, source, target string, progress Progress) error
}

func newTaskQueue(notify func(TaskView), run func(ctx context.Context, kind, source, target string, progress Progress) error) *taskQueue {
	q := &taskQueue{
		tasks:  map[string]*task{},
		wake:   make(chan struct{}, 1),
		quit:   make(chan struct{}),
		notify: notify,
		run:    run,
	}
	go q.worker()
	return q
}

// enqueue registers a new transfer and wakes the worker.
func (q *taskQueue) enqueue(sessionID, kind, name, source, target string) TaskView {
	t := &task{
		TaskView: TaskView{
			ID:        uuid.NewString(),
			SessionID: sessionID,
			Kind:      kind,
			Name:      name,
			Status:    StatusQueued,
			Total:     -1,
		},
		source: source,
		target: target,
	}
	q.mu.Lock()
	q.tasks[t.ID] = t
	q.order = append(q.order, t.ID)
	view := t.TaskView
	q.mu.Unlock()

	q.notify(view)
	q.kick()
	return view
}

// cancel stops a queued or running task. Finished tasks are left untouched.
func (q *taskQueue) cancelTask(id string) error {
	q.mu.Lock()
	t, ok := q.tasks[id]
	if !ok {
		q.mu.Unlock()
		return ErrNoTask
	}
	switch t.Status {
	case StatusQueued:
		t.Status = StatusCanceled
		t.Error = ""
		view := t.TaskView
		q.mu.Unlock()
		q.notify(view)
		return nil
	case StatusRunning:
		cancel := t.cancel
		q.mu.Unlock()
		if cancel != nil {
			cancel() // the worker reports the canceled state
		}
		return nil
	default:
		q.mu.Unlock()
		return nil
	}
}

// retry re-queues a failed or canceled task.
func (q *taskQueue) retryTask(id string) error {
	q.mu.Lock()
	t, ok := q.tasks[id]
	if !ok {
		q.mu.Unlock()
		return ErrNoTask
	}
	if t.Status != StatusFailed && t.Status != StatusCanceled {
		q.mu.Unlock()
		return nil
	}
	t.Status = StatusQueued
	t.Error = ""
	t.Done = 0
	t.Total = -1
	t.File = ""
	view := t.TaskView
	q.mu.Unlock()

	q.notify(view)
	q.kick()
	return nil
}

// clearFinished drops every task that is no longer queued or running.
func (q *taskQueue) clearFinished() []string {
	q.mu.Lock()
	defer q.mu.Unlock()
	removed := make([]string, 0, len(q.order))
	kept := q.order[:0]
	for _, id := range q.order {
		t := q.tasks[id]
		if t.Status == StatusQueued || t.Status == StatusRunning {
			kept = append(kept, id)
			continue
		}
		delete(q.tasks, id)
		removed = append(removed, id)
	}
	q.order = kept
	return removed
}

// list snapshots every task in insertion order.
func (q *taskQueue) list() []TaskView {
	q.mu.Lock()
	defer q.mu.Unlock()
	out := make([]TaskView, 0, len(q.order))
	for _, id := range q.order {
		out = append(out, q.tasks[id].TaskView)
	}
	return out
}

// close cancels the running task and stops the worker. Queued tasks are marked
// canceled so the UI does not show them as waiting forever.
func (q *taskQueue) close() {
	q.once.Do(func() { close(q.quit) })

	q.mu.Lock()
	var views []TaskView
	for _, t := range q.tasks {
		switch t.Status {
		case StatusQueued:
			t.Status = StatusCanceled
			views = append(views, t.TaskView)
		case StatusRunning:
			if t.cancel != nil {
				t.cancel()
			}
		}
	}
	q.mu.Unlock()
	for _, v := range views {
		q.notify(v)
	}
}

// kick nudges the worker without blocking.
func (q *taskQueue) kick() {
	select {
	case q.wake <- struct{}{}:
	default:
	}
}

func (q *taskQueue) worker() {
	for {
		select {
		case <-q.quit:
			return
		case <-q.wake:
		}
		for {
			t := q.nextQueued()
			if t == nil {
				break
			}
			q.runOne(t)
		}
	}
}

// nextQueued claims the oldest queued task, moving it to running.
func (q *taskQueue) nextQueued() *task {
	q.mu.Lock()
	defer q.mu.Unlock()
	select {
	case <-q.quit:
		return nil
	default:
	}
	for _, id := range q.order {
		t := q.tasks[id]
		if t.Status != StatusQueued {
			continue
		}
		ctx, cancel := context.WithCancel(context.Background())
		t.Status = StatusRunning
		t.cancel = cancel
		t.ctxStash = ctx
		return t
	}
	return nil
}

func (q *taskQueue) runOne(t *task) {
	q.mu.Lock()
	view := t.TaskView
	source, target := t.source, t.target
	ctx := t.ctxStash
	q.mu.Unlock()
	q.notify(view)

	progress := func(file string, done, total int64) {
		q.mu.Lock()
		t.File = file
		t.Done = done
		t.Total = total
		v := t.TaskView
		q.mu.Unlock()
		q.notify(v)
	}

	err := q.run(ctx, view.Kind, source, target, progress)
	// Read before the cleanup cancel below, which would make ctx.Err()
	// non-nil for every outcome.
	wasCanceled := ctx.Err() != nil

	q.mu.Lock()
	if t.cancel != nil {
		t.cancel()
		t.cancel = nil
	}
	t.ctxStash = nil
	switch {
	case err == nil:
		t.Status = StatusDone
		t.Error = ""
	case errors.Is(err, context.Canceled) || wasCanceled:
		t.Status = StatusCanceled
		t.Error = ""
	default:
		t.Status = StatusFailed
		t.Error = err.Error()
	}
	v := t.TaskView
	q.mu.Unlock()
	q.notify(v)
}
