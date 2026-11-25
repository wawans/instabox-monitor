package poller

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"sync"
	"time"

	"instabox-monitor/internal/config"
	"instabox-monitor/internal/crypto"
	"instabox-monitor/internal/instabox"
	"instabox-monitor/internal/store"
)

// ErrKeyMismatch is returned when an account's stored API key cannot be decrypted with the active APP_KEY.
var ErrKeyMismatch = errors.New("stored API key cannot be decrypted with active APP_KEY")

const (
	maxMetricsConcurrencyPerAccount = 4
	maxMetricsVMsPerCycle           = 25
	metadataRefreshInterval         = 60 * time.Second
	maxTransientBackoff             = 5 * time.Minute
)

// VMLiveTelemetry holds compact live telemetry rendered in the Fleet overview table/cards.
type VMLiveTelemetry struct {
	Timestamp            string                `json:"timestamp"`
	CPUCount             int                   `json:"cpuCount"`
	CPUUsedPct           float64               `json:"cpuUsedPct"`
	MemUsed              int64                 `json:"memUsed"`
	MemTotal             int64                 `json:"memTotal"`
	MemUsedPct           float64               `json:"memUsedPct"`
	DiskUsedPct          *float64              `json:"diskUsedPct,omitempty"`
	DiskLevel            string                `json:"diskLevel,omitempty"`
	DiskWarning          *instabox.DiskWarning `json:"diskWarning,omitempty"`
	GPUCount             int                   `json:"gpuCount,omitempty"`
	GPUUsedPct           float64               `json:"gpuUsedPct,omitempty"`
	NetInBytesPerSec     float64               `json:"netInBytesPerSec,omitempty"`
	NetOutBytesPerSec    float64               `json:"netOutBytesPerSec,omitempty"`
	DiskReadBytesPerSec  float64               `json:"diskReadBytesPerSec,omitempty"`
	DiskWriteBytesPerSec float64               `json:"diskWriteBytesPerSec,omitempty"`
}

// AccountCache stores the latest in-memory fleet data for one account.
type AccountCache struct {
	AccountID        string
	Machines         []instabox.Machine
	Ports            []instabox.PublicPort
	LiveMetrics      map[string]VMLiveTelemetry
	FetchedAt        time.Time
	MetricsFetchedAt *time.Time
	MetaFetchedAt    time.Time
}

type accountWorker struct {
	cancel    context.CancelFunc
	triggerCh chan struct{}
	done      chan struct{}
}

// Manager coordinates isolated per-account background pollers, SQLite snapshot persistence,
// startup freshness checks, tiered metrics polling, and SSE event broadcasting.
type Manager struct {
	cfg    config.Config
	store  *store.Store
	cipher *crypto.Cipher
	log    *slog.Logger
	broker *Broker

	mu      sync.RWMutex
	rootCtx context.Context
	cancel  context.CancelFunc
	workers map[string]*accountWorker
	cache   map[string]*AccountCache

	// For testing overrides (defaults to time.Now and cfg intervals).
	nowFn               func() time.Time
	pollInterval        time.Duration
	metricsPollInterval time.Duration
	maxAuthFailures     int
}

// NewManager creates a new poller Manager.
func NewManager(cfg config.Config, st *store.Store, ciph *crypto.Cipher, log *slog.Logger) *Manager {
	if log == nil {
		log = slog.Default()
	}
	return &Manager{
		cfg:                 cfg,
		store:               st,
		cipher:              ciph,
		log:                 log,
		broker:              NewBroker(),
		workers:             make(map[string]*accountWorker),
		cache:               make(map[string]*AccountCache),
		nowFn:               func() time.Time { return time.Now().UTC() },
		pollInterval:        cfg.PollInterval(),
		metricsPollInterval: cfg.MetricsPollInterval(),
		maxAuthFailures:     cfg.AccountMaxAuthFailures,
	}
}

// Broker returns the SSE event broker.
func (m *Manager) Broker() *Broker {
	return m.broker
}

// Start loads persisted SQLite snapshots into memory and launches an isolated poller goroutine
// for every enabled account, performing a startup freshness check per account.
func (m *Manager) Start(ctx context.Context) error {
	m.mu.Lock()
	m.rootCtx, m.cancel = context.WithCancel(ctx)
	m.mu.Unlock()

	// 1. Hydrate in-memory cache from persisted account_snapshots for instant UI availability.
	snaps, err := m.store.ListSnapshots(ctx)
	if err != nil {
		return fmt.Errorf("load persisted snapshots: %w", err)
	}
	m.mu.Lock()
	for _, s := range snaps {
		m.cache[s.AccountID] = decodeSnapshot(s)
	}
	m.mu.Unlock()

	// 2. Launch isolated worker per enabled account (non-blocking on APP_KEY mismatch).
	accounts, err := m.store.ListAccounts(ctx)
	if err != nil {
		return fmt.Errorf("list accounts for poller: %w", err)
	}
	for _, acc := range accounts {
		m.reconcileAccountLockedCheck(ctx, acc)
	}
	return nil
}

// Stop gracefully cancels all per-account workers and waits for them to exit.
func (m *Manager) Stop() {
	m.mu.Lock()
	if m.cancel != nil {
		m.cancel()
	}
	workers := make([]*accountWorker, 0, len(m.workers))
	for _, w := range m.workers {
		w.cancel()
		workers = append(workers, w)
	}
	m.workers = make(map[string]*accountWorker)
	m.mu.Unlock()

	for _, w := range workers {
		<-w.done
	}
}

// ReconcileAccount starts, restarts, or stops the poller worker for a single account after CRUD changes.
func (m *Manager) ReconcileAccount(ctx context.Context, accountID string) {
	acc, err := m.store.GetAccount(ctx, accountID)
	if errors.Is(err, store.ErrNotFound) {
		m.stopWorker(accountID)
		m.mu.Lock()
		delete(m.cache, accountID)
		m.mu.Unlock()
		m.broker.Publish(Event{Type: "account_updated", AccountID: accountID})
		return
	}
	if err != nil {
		m.log.Error("reconcile account lookup failed", "accountId", accountID, "error", err)
		return
	}
	// Stop existing worker first so updated keys/baseURL take effect cleanly.
	m.stopWorker(accountID)
	m.reconcileAccountLockedCheck(ctx, acc)
	m.broker.Publish(Event{Type: "account_updated", AccountID: accountID})
}

// SyncNow triggers an immediate background poll for one account (or all running workers if accountID == "").
func (m *Manager) SyncNow(accountID string) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if accountID != "" {
		if w, ok := m.workers[accountID]; ok {
			select {
			case w.triggerCh <- struct{}{}:
			default:
			}
		}
		return
	}
	for _, w := range m.workers {
		select {
		case w.triggerCh <- struct{}{}:
		default:
		}
	}
}

// SnapshotCopy returns a safe copy of all cached account snapshots.
func (m *Manager) SnapshotCopy() map[string]AccountCache {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make(map[string]AccountCache, len(m.cache))
	for id, c := range m.cache {
		cp := AccountCache{
			AccountID:        c.AccountID,
			Machines:         append([]instabox.Machine(nil), c.Machines...),
			Ports:            append([]instabox.PublicPort(nil), c.Ports...),
			LiveMetrics:      make(map[string]VMLiveTelemetry, len(c.LiveMetrics)),
			FetchedAt:        c.FetchedAt,
			MetricsFetchedAt: c.MetricsFetchedAt,
			MetaFetchedAt:    c.MetaFetchedAt,
		}
		for k, v := range c.LiveMetrics {
			cp.LiveMetrics[k] = v
		}
		out[id] = cp
	}
	return out
}

// SanitizePublicPort strips secret Token and TokenURL fields so private port secrets
// are never held in memory caches, SQLite snapshots, or GET responses.
func SanitizePublicPort(p instabox.PublicPort) instabox.PublicPort {
	p.Token = ""
	p.TokenURL = ""
	return p
}

func sanitizePublicPorts(ports []instabox.PublicPort) []instabox.PublicPort {
	if len(ports) == 0 {
		return nil
	}
	out := make([]instabox.PublicPort, len(ports))
	for i, p := range ports {
		out[i] = SanitizePublicPort(p)
	}
	return out
}

// UpsertCachedPort inserts or replaces a machine port in the in-memory cache and SQLite snapshot
// after stripping Token and TokenURL, then broadcasts fleet_updated.
func (m *Manager) UpsertCachedPort(ctx context.Context, accountID string, p instabox.PublicPort) {
	clean := SanitizePublicPort(p)
	m.updateCachedPorts(ctx, accountID, func(ports []instabox.PublicPort) []instabox.PublicPort {
		next := make([]instabox.PublicPort, len(ports))
		copy(next, ports)
		for i, existing := range next {
			if (clean.MachineID != "" && existing.MachineID == clean.MachineID && existing.Port == clean.Port) ||
				(clean.ID != "" && existing.ID == clean.ID) {
				next[i] = clean
				return next
			}
		}
		return append(next, clean)
	})
}

// RemoveCachedPort deletes a machine port from the in-memory cache and SQLite snapshot,
// then broadcasts fleet_updated.
func (m *Manager) RemoveCachedPort(ctx context.Context, accountID, machineID string, port int) {
	m.updateCachedPorts(ctx, accountID, func(ports []instabox.PublicPort) []instabox.PublicPort {
		next := make([]instabox.PublicPort, 0, len(ports))
		for _, existing := range ports {
			if existing.MachineID == machineID && existing.Port == port {
				continue
			}
			next = append(next, existing)
		}
		return next
	})
}

// ReplaceMachineCachedPorts synchronizes all ports for a single machine into the account cache
// and SQLite snapshot while keeping other machines' ports intact and stripping secrets.
// Skips persistence and SSE broadcast if the machine's sanitized port list is unchanged.
func (m *Manager) ReplaceMachineCachedPorts(ctx context.Context, accountID, machineID string, machinePorts []instabox.PublicPort) {
	if ctx == nil {
		ctx = context.Background()
	}
	sanitized := sanitizePublicPorts(machinePorts)
	for i := range sanitized {
		if sanitized[i].MachineID == "" {
			sanitized[i].MachineID = machineID
		}
	}

	m.mu.Lock()
	c, ok := m.cache[accountID]
	if !ok || c == nil {
		if len(sanitized) == 0 {
			m.mu.Unlock()
			return
		}
		c = &AccountCache{
			AccountID:   accountID,
			LiveMetrics: make(map[string]VMLiveTelemetry),
			FetchedAt:   m.nowFn(),
		}
		m.cache[accountID] = c
	}
	if c.FetchedAt.IsZero() {
		c.FetchedAt = m.nowFn()
	}

	var existingMachine []instabox.PublicPort
	otherPorts := make([]instabox.PublicPort, 0, len(c.Ports))
	for _, p := range c.Ports {
		if p.MachineID == machineID {
			existingMachine = append(existingMachine, p)
		} else {
			otherPorts = append(otherPorts, p)
		}
	}

	if publicPortsEqual(existingMachine, sanitized) {
		m.mu.Unlock()
		return
	}

	next := make([]instabox.PublicPort, 0, len(otherPorts)+len(sanitized))
	next = append(next, otherPorts...)
	next = append(next, sanitized...)
	c.Ports = next
	snap := buildAccountSnapshot(accountID, c.Machines, c.Ports, c.LiveMetrics, c.FetchedAt, c.MetricsFetchedAt)
	m.mu.Unlock()

	_ = m.store.SaveSnapshot(ctx, snap)
	m.broker.Publish(Event{Type: "fleet_updated", AccountID: accountID})
}

func publicPortsEqual(a, b []instabox.PublicPort) bool {
	if len(a) != len(b) {
		return false
	}
	if len(a) == 0 {
		return true
	}
	norm := func(in []instabox.PublicPort) []instabox.PublicPort {
		out := sanitizePublicPorts(in)
		sort.Slice(out, func(i, j int) bool {
			if out[i].Port != out[j].Port {
				return out[i].Port < out[j].Port
			}
			if out[i].Protocol != out[j].Protocol {
				return out[i].Protocol < out[j].Protocol
			}
			return out[i].ID < out[j].ID
		})
		return out
	}
	na := norm(a)
	nb := norm(b)
	for i := range na {
		if na[i].ID != nb[i].ID ||
			na[i].MachineID != nb[i].MachineID ||
			na[i].Name != nb[i].Name ||
			na[i].Port != nb[i].Port ||
			na[i].Protocol != nb[i].Protocol ||
			na[i].Access != nb[i].Access ||
			na[i].Address != nb[i].Address ||
			na[i].URL != nb[i].URL ||
			na[i].CreatedAt != nb[i].CreatedAt {
			return false
		}
	}
	return true
}

func (m *Manager) updateCachedPorts(ctx context.Context, accountID string, mutate func([]instabox.PublicPort) []instabox.PublicPort) {
	if ctx == nil {
		ctx = context.Background()
	}

	m.mu.Lock()
	c, ok := m.cache[accountID]
	if !ok || c == nil {
		c = &AccountCache{
			AccountID:   accountID,
			LiveMetrics: make(map[string]VMLiveTelemetry),
			FetchedAt:   m.nowFn(),
		}
		m.cache[accountID] = c
	}
	if c.FetchedAt.IsZero() {
		c.FetchedAt = m.nowFn()
	}
	c.Ports = sanitizePublicPorts(mutate(c.Ports))
	snap := buildAccountSnapshot(accountID, c.Machines, c.Ports, c.LiveMetrics, c.FetchedAt, c.MetricsFetchedAt)
	m.mu.Unlock()

	_ = m.store.SaveSnapshot(ctx, snap)
	m.broker.Publish(Event{Type: "fleet_updated", AccountID: accountID})
}

func buildAccountSnapshot(
	accountID string,
	machines []instabox.Machine,
	ports []instabox.PublicPort,
	metrics map[string]VMLiveTelemetry,
	fetchedAt time.Time,
	metricsFetchedAt *time.Time,
) store.AccountSnapshot {
	mBytes, _ := json.Marshal(machines)
	pBytes, _ := json.Marshal(sanitizePublicPorts(ports))
	metBytes, _ := json.Marshal(metrics)
	return store.AccountSnapshot{
		AccountID:        accountID,
		MachinesJSON:     string(mBytes),
		PortsJSON:        string(pBytes),
		MetricsJSON:      string(metBytes),
		FetchedAt:        fetchedAt,
		MetricsFetchedAt: metricsFetchedAt,
	}
}

// ClientForAccount decrypts an account's stored API key and returns a configured InstaBox client.
func (m *Manager) ClientForAccount(ctx context.Context, accountID string) (*instabox.Client, store.Account, error) {
	acc, err := m.store.GetAccount(ctx, accountID)
	if err != nil {
		return nil, store.Account{}, err
	}
	plain, err := m.cipher.Decrypt(acc.APIKeyEnc)
	if err != nil {
		_ = m.store.UpdateAccountSyncState(ctx, acc.ID, store.StatusKeyError, ErrKeyMismatch.Error(), nil, acc.ConsecutiveAuthFailures, acc.Enabled, acc.DisabledReason, "", "", "")
		return nil, acc, ErrKeyMismatch
	}
	return instabox.NewClient(acc.BaseURL, plain), acc, nil
}

// TrackOperation long-polls an asynchronous InstaBox operation in the background,
// broadcasts SSE operation_updated events, and triggers an immediate account refresh when finished.
func (m *Manager) TrackOperation(accountID, machineID, machineName string, initialOp instabox.Operation) {
	m.mu.RLock()
	parentCtx := m.rootCtx
	m.mu.RUnlock()
	if parentCtx == nil {
		parentCtx = context.Background()
	}

	m.broker.Publish(Event{
		Type:      "operation_updated",
		AccountID: accountID,
		MachineID: machineID,
		Payload:   initialOp,
	})

	go func() {
		defer func() {
			if r := recover(); r != nil {
				m.log.Error("operation tracker panic recovered", "accountId", accountID, "opId", initialOp.ID, "panic", r)
			}
		}()

		ctx, cancel := context.WithTimeout(parentCtx, 3*time.Minute)
		defer cancel()

		client, _, err := m.ClientForAccount(ctx, accountID)
		if err != nil {
			return
		}

		cur := initialOp
		for cur.State == "queued" || cur.State == "running" {
			next, err := client.GetOperation(ctx, cur.ID, 20)
			if err != nil {
				m.log.Debug("operation poll error", "accountId", accountID, "opId", cur.ID, "error", err)
				select {
				case <-ctx.Done():
					return
				case <-time.After(3 * time.Second):
					continue
				}
			}
			cur = next
			m.broker.Publish(Event{
				Type:      "operation_updated",
				AccountID: accountID,
				MachineID: machineID,
				Payload:   cur,
			})
		}

		detail := fmt.Sprintf("Operation %s (%s) %s", cur.Type, cur.ID, cur.State)
		if cur.Error != nil && cur.Error.Message != "" {
			detail += ": " + cur.Error.Message
		}
		_ = m.store.AddActivityEvent(context.Background(), store.ActivityEvent{
			AccountID:   accountID,
			MachineID:   machineID,
			MachineName: machineName,
			EventType:   "lifecycle",
			Detail:      detail,
		})
		m.SyncNow(accountID)
	}()
}

func (m *Manager) reconcileAccountLockedCheck(ctx context.Context, acc store.Account) {
	if !acc.Enabled {
		m.stopWorker(acc.ID)
		return
	}

	// Verify API key decrypts cleanly with active APP_KEY (non-blocking startup on mismatch).
	plainKey, err := m.cipher.Decrypt(acc.APIKeyEnc)
	if err != nil {
		m.log.Error("failed to decrypt account API key; pausing account poller (key_error)", "accountId", acc.ID, "name", acc.Name)
		_ = m.store.UpdateAccountSyncState(
			ctx, acc.ID, store.StatusKeyError, ErrKeyMismatch.Error(),
			nil, acc.ConsecutiveAuthFailures, acc.Enabled, acc.DisabledReason,
			"", "", "",
		)
		m.stopWorker(acc.ID)
		m.broker.Publish(Event{Type: "account_updated", AccountID: acc.ID})
		return
	}

	// Startup freshness check: compute initial delay from persisted snapshot timestamp.
	var initialDelay time.Duration
	m.mu.RLock()
	snap, hasSnap := m.cache[acc.ID]
	parentCtx := m.rootCtx
	m.mu.RUnlock()
	if parentCtx == nil {
		return
	}

	if hasSnap && !snap.FetchedAt.IsZero() {
		age := m.nowFn().Sub(snap.FetchedAt)
		if age >= 0 && age < m.pollInterval {
			initialDelay = m.pollInterval - age
			m.log.Debug("startup cache fresh; deferring first poll", "accountId", acc.ID, "age", age.Round(time.Millisecond), "nextIn", initialDelay.Round(time.Millisecond))
		} else {
			m.log.Debug("startup cache stale; running immediate poll", "accountId", acc.ID, "age", age.Round(time.Millisecond))
		}
	} else {
		m.log.Debug("no startup cache found; running immediate poll", "accountId", acc.ID)
	}

	wCtx, wCancel := context.WithCancel(parentCtx)
	w := &accountWorker{
		cancel:    wCancel,
		triggerCh: make(chan struct{}, 1),
		done:      make(chan struct{}),
	}

	m.mu.Lock()
	m.workers[acc.ID] = w
	m.mu.Unlock()

	client := instabox.NewClient(acc.BaseURL, plainKey)
	go m.runAccountLoop(wCtx, w, acc.ID, client, initialDelay)
}

func (m *Manager) stopWorker(accountID string) {
	m.mu.Lock()
	w, ok := m.workers[accountID]
	if ok {
		delete(m.workers, accountID)
	}
	m.mu.Unlock()
	if ok {
		w.cancel()
		<-w.done
	}
}

func (m *Manager) runAccountLoop(ctx context.Context, w *accountWorker, accountID string, client *instabox.Client, initialDelay time.Duration) {
	defer close(w.done)
	defer func() {
		if r := recover(); r != nil {
			m.log.Error("isolated account poller recovered from panic", "accountId", accountID, "panic", r)
		}
	}()

	nextDelay := initialDelay
	transientStreak := 0

	for {
		forced := false
		if nextDelay > 0 {
			timer := time.NewTimer(nextDelay)
			select {
			case <-ctx.Done():
				timer.Stop()
				return
			case <-w.triggerCh:
				timer.Stop()
				forced = true
			case <-timer.C:
			}
		} else {
			select {
			case <-ctx.Done():
				return
			default:
			}
		}

		delay, stopWorker := m.pollOnce(ctx, accountID, client, forced, &transientStreak)
		if stopWorker {
			m.mu.Lock()
			if cur, ok := m.workers[accountID]; ok && cur == w {
				delete(m.workers, accountID)
			}
			m.mu.Unlock()
			return
		}
		nextDelay = delay
	}
}

func (m *Manager) pollOnce(ctx context.Context, accountID string, client *instabox.Client, forced bool, transientStreak *int) (time.Duration, bool) {
	acc, err := m.store.GetAccount(ctx, accountID)
	if err != nil || !acc.Enabled {
		return 0, true
	}

	now := m.nowFn()
	machines, err := client.ListMachines(ctx)
	if err != nil {
		return m.handlePollError(ctx, acc, err, transientStreak)
	}

	portsResp, portErr := client.ListPorts(ctx)
	var ports []instabox.PublicPort
	if portErr == nil {
		ports = sanitizePublicPorts(portsResp.Ports)
	} else {
		m.log.Debug("list ports warning", "accountId", accountID, "error", portErr)
	}

	// Refresh identity & org quotas on first sync, forced sync, or every 60s.
	m.mu.RLock()
	prev := m.cache[accountID]
	var prevMetaAt time.Time
	var prevMetricsAt *time.Time
	var prevMetrics map[string]VMLiveTelemetry
	var prevMachines []instabox.Machine
	if prev != nil {
		prevMetaAt = prev.MetaFetchedAt
		prevMetricsAt = prev.MetricsFetchedAt
		prevMetrics = prev.LiveMetrics
		prevMachines = prev.Machines
	}
	m.mu.RUnlock()

	var userLogin, userEmail, orgsJSON string
	metaFetchedAt := prevMetaAt
	if forced || prevMetaAt.IsZero() || now.Sub(prevMetaAt) >= metadataRefreshInterval || acc.OrgsJSON == "" || acc.OrgsJSON == "[]" {
		if me, meErr := client.GetMe(ctx); meErr == nil {
			userLogin = me.Login
			userEmail = me.Email
		}
		if orgs, orgErr := client.ListOrgs(ctx); orgErr == nil {
			if b, jErr := json.Marshal(orgs); jErr == nil {
				orgsJSON = string(b)
			}
		}
		metaFetchedAt = now
	}

	// Tiered live metrics enrichment for running VMs.
	liveMetrics := make(map[string]VMLiveTelemetry, len(prevMetrics))
	for k, v := range prevMetrics {
		liveMetrics[k] = v
	}
	metricsFetchedAt := prevMetricsAt
	shouldFetchMetrics := m.metricsPollInterval > 0 && (forced || prevMetricsAt == nil || now.Sub(*prevMetricsAt) >= m.metricsPollInterval)
	if shouldFetchMetrics {
		fetched := m.fetchRunningMetrics(ctx, client, machines)
		liveMetrics = fetched
		t := now
		metricsFetchedAt = &t
	} else {
		// Drop stale entries for machines that are no longer running.
		runningSet := make(map[string]struct{})
		for _, vm := range machines {
			if vm.State == "running" {
				runningSet[vm.ID] = struct{}{}
			}
		}
		for id := range liveMetrics {
			if _, ok := runningSet[id]; !ok {
				delete(liveMetrics, id)
			}
		}
	}

	// Detect VM state transitions for activity log.
	if len(prevMachines) > 0 {
		prevState := make(map[string]string, len(prevMachines))
		for _, pm := range prevMachines {
			prevState[pm.ID] = pm.State
		}
		for _, vm := range machines {
			if old, ok := prevState[vm.ID]; ok && old != vm.State {
				_ = m.store.AddActivityEvent(ctx, store.ActivityEvent{
					AccountID:   accountID,
					MachineID:   vm.ID,
					MachineName: vm.Name,
					EventType:   "state_change",
					Detail:      fmt.Sprintf("%s changed state: %s -> %s", vm.Name, old, vm.State),
				})
			}
		}
	}

	*transientStreak = 0
	syncAt := now
	_ = m.store.UpdateAccountSyncState(
		ctx, accountID, store.StatusOK, "", &syncAt,
		0, true, "", userLogin, userEmail, orgsJSON,
	)

	// Persist snapshot to SQLite for startup freshness checks.
	_ = m.store.SaveSnapshot(ctx, buildAccountSnapshot(accountID, machines, ports, liveMetrics, now, metricsFetchedAt))

	m.mu.Lock()
	m.cache[accountID] = &AccountCache{
		AccountID:        accountID,
		Machines:         machines,
		Ports:            ports,
		LiveMetrics:      liveMetrics,
		FetchedAt:        now,
		MetricsFetchedAt: metricsFetchedAt,
		MetaFetchedAt:    metaFetchedAt,
	}
	m.mu.Unlock()

	m.broker.Publish(Event{Type: "fleet_updated", AccountID: accountID})
	return m.pollInterval, false
}

func (m *Manager) handlePollError(ctx context.Context, acc store.Account, err error, transientStreak *int) (time.Duration, bool) {
	if errors.Is(err, context.Canceled) {
		return 0, true
	}

	var apiErr *instabox.APIError
	if errors.As(err, &apiErr) {
		// 1. 401 Auth Error -> increment counter, auto-disable at threshold.
		if apiErr.IsAuthError() {
			failures := acc.ConsecutiveAuthFailures + 1
			errMsg := apiErr.Error()
			if apiErr.Hint != "" {
				errMsg += " (" + apiErr.Hint + ")"
			}

			if m.maxAuthFailures > 0 && failures >= m.maxAuthFailures {
				reason := fmt.Sprintf("Auto-disabled after %d consecutive 401 auth errors: %s", failures, apiErr.Code)
				m.log.Warn("auto-disabling account after consecutive 401 failures",
					"accountId", acc.ID, "name", acc.Name, "failures", failures, "code", apiErr.Code)
				_ = m.store.UpdateAccountSyncState(
					ctx, acc.ID, store.StatusAutoDisabled, errMsg, nil,
					failures, false, reason, "", "", "",
				)
				_ = m.store.AddActivityEvent(ctx, store.ActivityEvent{
					AccountID: acc.ID,
					EventType: "account_auto_disabled",
					Detail:    fmt.Sprintf("%s: %s", acc.Name, reason),
				})
				m.broker.Publish(Event{Type: "account_updated", AccountID: acc.ID})
				return 0, true
			}

			m.log.Warn("account 401 auth error", "accountId", acc.ID, "name", acc.Name, "failures", failures, "max", m.maxAuthFailures)
			_ = m.store.UpdateAccountSyncState(
				ctx, acc.ID, store.StatusAuthError, errMsg, nil,
				failures, true, "", "", "", "",
			)
			m.broker.Publish(Event{Type: "account_updated", AccountID: acc.ID})
			return m.pollInterval, false
		}

		// 2. 429 Rate Limited -> per-account cooldown, do NOT touch auth failure counter.
		if apiErr.IsRateLimited() {
			wait := apiErr.RetryAfter()
			m.log.Warn("account rate limited; backing off isolated poller", "accountId", acc.ID, "retryAfter", wait)
			_ = m.store.UpdateAccountSyncState(
				ctx, acc.ID, store.StatusRateLimited, apiErr.Error(), nil,
				acc.ConsecutiveAuthFailures, true, "", "", "", "",
			)
			m.broker.Publish(Event{Type: "account_updated", AccountID: acc.ID})
			return wait, false
		}

		// 3. 403 Missing Scope -> permission error, do NOT auto-disable.
		if apiErr.IsMissingScope() {
			m.log.Warn("account missing scope", "accountId", acc.ID, "scopes", apiErr.RequiredScopes)
			_ = m.store.UpdateAccountSyncState(
				ctx, acc.ID, store.StatusPermissionError, apiErr.Error(), nil,
				acc.ConsecutiveAuthFailures, true, "", "", "", "",
			)
			m.broker.Publish(Event{Type: "account_updated", AccountID: acc.ID})
			delay := m.pollInterval * 2
			if delay > time.Minute {
				delay = time.Minute
			}
			return delay, false
		}
	}

	// 4. Transient network / 5xx error -> exponential backoff capped at 5m, keep stale cache.
	*transientStreak++
	backoff := m.pollInterval
	for i := 1; i < *transientStreak && backoff < maxTransientBackoff; i++ {
		backoff *= 2
	}
	if backoff > maxTransientBackoff {
		backoff = maxTransientBackoff
	}
	m.log.Warn("account poll transient error", "accountId", acc.ID, "name", acc.Name, "streak", *transientStreak, "nextIn", backoff, "error", err)
	_ = m.store.UpdateAccountSyncState(
		ctx, acc.ID, store.StatusError, err.Error(), nil,
		acc.ConsecutiveAuthFailures, true, "", "", "", "",
	)
	m.broker.Publish(Event{Type: "account_updated", AccountID: acc.ID})
	return backoff, false
}

func (m *Manager) fetchRunningMetrics(ctx context.Context, client *instabox.Client, machines []instabox.Machine) map[string]VMLiveTelemetry {
	var running []instabox.Machine
	for _, vm := range machines {
		if vm.State == "running" {
			running = append(running, vm)
			if len(running) >= maxMetricsVMsPerCycle {
				break
			}
		}
	}
	if len(running) == 0 {
		return map[string]VMLiveTelemetry{}
	}

	out := make(map[string]VMLiveTelemetry, len(running))
	var outMu sync.Mutex
	sem := make(chan struct{}, maxMetricsConcurrencyPerAccount)
	var wg sync.WaitGroup

	for _, vm := range running {
		vm := vm
		wg.Add(1)
		go func() {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
				defer func() { <-sem }()
			case <-ctx.Done():
				return
			}

			resp, err := client.GetMachineMetrics(ctx, vm.ID, "2m")
			if err != nil {
				return
			}
			var tel VMLiveTelemetry
			if len(resp.Metrics) > 0 {
				latest := resp.Metrics[len(resp.Metrics)-1]
				tel.Timestamp = latest.Timestamp
				tel.CPUCount = latest.CPUCount
				tel.CPUUsedPct = latest.CPUUsedPct
				tel.MemUsed = latest.MemUsed
				tel.MemTotal = latest.MemTotal
				if latest.MemTotal > 0 {
					tel.MemUsedPct = (float64(latest.MemUsed) / float64(latest.MemTotal)) * 100
				}
				tel.GPUCount = latest.GPUCount
				tel.GPUUsedPct = latest.GPUUsedPct
				tel.NetInBytesPerSec = latest.NetInBytesPerSec
				tel.NetOutBytesPerSec = latest.NetOutBytesPerSec
				tel.DiskReadBytesPerSec = latest.DiskReadBytesPerSec
				tel.DiskWriteBytesPerSec = latest.DiskWriteBytesPerSec
			}
			if resp.Disk != nil {
				tel.DiskWarning = resp.Disk.Warning
				for _, fs := range resp.Disk.Filesystems {
					if fs.Mount == "/data" || tel.DiskUsedPct == nil {
						pct := fs.UsedPct
						tel.DiskUsedPct = &pct
						tel.DiskLevel = fs.Level
						if fs.Mount == "/data" {
							break
						}
					}
				}
			}
			outMu.Lock()
			out[vm.ID] = tel
			outMu.Unlock()
		}()
	}
	wg.Wait()
	return out
}

func decodeSnapshot(s store.AccountSnapshot) *AccountCache {
	c := &AccountCache{
		AccountID:        s.AccountID,
		LiveMetrics:      make(map[string]VMLiveTelemetry),
		FetchedAt:        s.FetchedAt,
		MetricsFetchedAt: s.MetricsFetchedAt,
	}
	_ = json.Unmarshal([]byte(s.MachinesJSON), &c.Machines)
	_ = json.Unmarshal([]byte(s.PortsJSON), &c.Ports)
	c.Ports = sanitizePublicPorts(c.Ports)
	_ = json.Unmarshal([]byte(s.MetricsJSON), &c.LiveMetrics)
	if c.LiveMetrics == nil {
		c.LiveMetrics = make(map[string]VMLiveTelemetry)
	}
	return c
}
