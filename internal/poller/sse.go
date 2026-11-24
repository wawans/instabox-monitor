package poller

import (
	"encoding/json"
	"sync"
	"time"
)

// Event is pushed over SSE (/api/events) to connected dashboard clients.
type Event struct {
	Type      string    `json:"type"` // fleet_updated, account_updated, operation_updated
	AccountID string    `json:"accountId,omitempty"`
	MachineID string    `json:"machineId,omitempty"`
	Payload   any       `json:"payload,omitempty"`
	Timestamp time.Time `json:"timestamp"`
}

// Broker fans out lightweight SSE events to connected clients without blocking producers.
type Broker struct {
	mu      sync.RWMutex
	clients map[chan []byte]struct{}
}

// NewBroker constructs an SSE Broker.
func NewBroker() *Broker {
	return &Broker{
		clients: make(map[chan []byte]struct{}),
	}
}

// Subscribe registers a new client channel and returns an unsubscribe callback.
func (b *Broker) Subscribe() (<-chan []byte, func()) {
	ch := make(chan []byte, 32)
	b.mu.Lock()
	b.clients[ch] = struct{}{}
	b.mu.Unlock()

	return ch, func() {
		b.mu.Lock()
		if _, ok := b.clients[ch]; ok {
			delete(b.clients, ch)
			close(ch)
		}
		b.mu.Unlock()
	}
}

// Publish marshals an Event and delivers it non-blockingly to all connected clients.
func (b *Broker) Publish(ev Event) {
	if ev.Timestamp.IsZero() {
		ev.Timestamp = time.Now().UTC()
	}
	raw, err := json.Marshal(ev)
	if err != nil {
		return
	}

	b.mu.RLock()
	defer b.mu.RUnlock()
	for ch := range b.clients {
		select {
		case ch <- raw:
		default:
			// Slow consumer: drop event rather than blocking background pollers.
		}
	}
}
