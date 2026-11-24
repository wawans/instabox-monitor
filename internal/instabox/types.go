package instabox

import (
	"fmt"
	"strings"
	"time"
)

// APIError represents a structured error returned by the InstaBox REST API.
type APIError struct {
	StatusCode        int      `json:"statusCode"`
	Code              string   `json:"code"`
	Reason            string   `json:"reason,omitempty"`
	Message           string   `json:"message"`
	Hint              string   `json:"hint,omitempty"`
	Docs              string   `json:"docs,omitempty"`
	RequestID         string   `json:"requestId,omitempty"`
	RequiredScopes    []string `json:"requiredScopes,omitempty"`
	RetryAfterSeconds int      `json:"retryAfterSeconds,omitempty"`
	Retryable         bool     `json:"retryable,omitempty"`
}

func (e *APIError) Error() string {
	var parts []string
	if e.StatusCode > 0 {
		parts = append(parts, fmt.Sprintf("HTTP %d", e.StatusCode))
	}
	if e.Code != "" {
		parts = append(parts, e.Code)
	}
	if e.Message != "" {
		parts = append(parts, e.Message)
	}
	if len(parts) == 0 {
		return "instabox API error"
	}
	return strings.Join(parts, ": ")
}

// IsAuthError reports whether the error is a 401 credential failure (invalid/expired/revoked/missing key).
func (e *APIError) IsAuthError() bool {
	if e == nil {
		return false
	}
	if e.StatusCode == 401 {
		return true
	}
	switch e.Code {
	case "unauthenticated", "missing_key", "malformed_key", "invalid_key", "expired_key", "revoked_key", "api_key_expired", "api_key_revoked":
		return true
	}
	return false
}

// IsMissingScope reports whether the API key lacks required permissions (403 missing_scope / insufficient_scope).
func (e *APIError) IsMissingScope() bool {
	if e == nil {
		return false
	}
	return e.StatusCode == 403 && (e.Code == "missing_scope" || e.Code == "insufficient_scope" || e.Code == "permission_denied")
}

// IsRateLimited reports whether the API returned 429 rate_limited.
func (e *APIError) IsRateLimited() bool {
	return e != nil && (e.StatusCode == 429 || e.Code == "rate_limited")
}

// IsOperationConflict reports whether the API returned 409 operation_conflict.
func (e *APIError) IsOperationConflict() bool {
	return e != nil && (e.StatusCode == 409 || e.Code == "operation_conflict")
}

// RetryAfter returns the server-indicated cooldown duration, or a sensible default if rate-limited.
func (e *APIError) RetryAfter() time.Duration {
	if e != nil && e.RetryAfterSeconds > 0 {
		return time.Duration(e.RetryAfterSeconds) * time.Second
	}
	return 30 * time.Second
}

type errorBody struct {
	Error *APIError `json:"error"`
}

// Me mirrors GET /v1/me.
type Me struct {
	UserID         int64         `json:"userId"`
	Login          string        `json:"login"`
	Email          string        `json:"email"`
	Name           string        `json:"name"`
	AvatarURL      string        `json:"avatarUrl,omitempty"`
	OrgID          string        `json:"orgId"`
	Activated      bool          `json:"activated"`
	Disabled       bool          `json:"disabled"`
	MachineMetrics bool          `json:"machineMetrics"`
	Workspaces     []OrgRef      `json:"workspaces,omitempty"`
	AllowedSpecs   []MachineSpec `json:"allowedSpecs,omitempty"`
}

type OrgRef struct {
	ID              string `json:"id"`
	Kind            string `json:"kind"`
	Name            string `json:"name"`
	Tier            string `json:"tier"`
	AlwaysOnAllowed bool   `json:"alwaysOnAllowed,omitempty"`
}

type OrgList struct {
	Orgs []Org `json:"orgs"`
}

type Org struct {
	ID           string        `json:"id"`
	Kind         string        `json:"kind"`
	Name         string        `json:"name"`
	Personal     bool          `json:"personal"`
	Role         string        `json:"role"`
	Tier         string        `json:"tier"`
	CreatedAt    string        `json:"createdAt,omitempty"`
	DisabledAt   string        `json:"disabledAt,omitempty"`
	Limits       *OrgLimits    `json:"limits,omitempty"`
	Usage        *OrgUsage     `json:"usage,omitempty"`
	AllowedSpecs []MachineSpec `json:"allowedSpecs,omitempty"`
}

type OrgLimits struct {
	AlwaysOn          bool     `json:"alwaysOn"`
	MaxDiskGiB        int      `json:"maxDiskGiB"`
	MaxMachines       int      `json:"maxMachines"`
	MaxMembers        int      `json:"maxMembers"`
	MaxRunning        int      `json:"maxRunning"`
	MaxSnapshots      int      `json:"maxSnapshots"`
	MaxStoredGiB      int      `json:"maxStoredGiB"`
	MaxVCPUs          int      `json:"maxVCPUs"`
	StartsPerMinute   int      `json:"startsPerMinute"`
	SpendCapUSD       *float64 `json:"spendCapUSD,omitempty"`
	UsageAlertPercent int      `json:"usageAlertPercent,omitempty"`
}

type OrgUsage struct {
	AllocatedDiskGiB  int     `json:"allocatedDiskGiB"`
	Machines          int     `json:"machines"`
	Running           int     `json:"running"`
	Snapshots         int     `json:"snapshots"`
	StoredBytes       *int64  `json:"storedBytes,omitempty"`
	CostUSD           float64 `json:"costUSD,omitempty"`
	CreditRemaining   float64 `json:"creditRemainingUSD,omitempty"`
	VCPUHours         float64 `json:"vcpuHours,omitempty"`
	MemGiBHours       float64 `json:"memGiBHours,omitempty"`
	EgressGiB         float64 `json:"egressGiB,omitempty"`
}

// Usage mirrors GET /v1/usage.
type Usage struct {
	AllocatedDiskGiB int          `json:"allocatedDiskGiB"`
	Machines         int          `json:"machines"`
	Snapshots        int          `json:"snapshots"`
	StoredBytes      int64        `json:"storedBytes"`
	LogicalBytes     int64        `json:"logicalBytes"`
	ExclusiveBytes   int64        `json:"exclusiveBytes"`
	Limits           *UsageLimits `json:"limits,omitempty"`
}

type UsageLimits struct {
	MaxMachines  int `json:"maxMachines"`
	MaxSnapshots int `json:"maxSnapshots"`
	MaxStoredGiB int `json:"maxStoredGiB"`
}

// MachineList mirrors GET /v1/machines.
type MachineList struct {
	Machines   []Machine `json:"machines"`
	NextCursor *string   `json:"nextCursor"`
}

// Machine mirrors a sandbox object from GET /v1/machines and GET /v1/machines/{id}.
type Machine struct {
	ID                      string            `json:"id"`
	Name                    string            `json:"name"`
	OrgID                   string            `json:"orgId"`
	State                   string            `json:"state"`
	DesiredState            string            `json:"desiredState,omitempty"`
	Free                    bool              `json:"free"`
	GuestUser               string            `json:"guestUser,omitempty"`
	OperationID             *string           `json:"operationId,omitempty"`
	AutoSuspendAfterSeconds *int              `json:"autoSuspendAfterSeconds,omitempty"`
	AutoSuspendedAt         string            `json:"autoSuspendedAt,omitempty"`
	CooldownReason          string            `json:"cooldownReason,omitempty"`
	CooldownUntil           *string           `json:"cooldownUntil,omitempty"`
	CreatedAt               string            `json:"createdAt"`
	UpdatedAt               string            `json:"updatedAt,omitempty"`
	ReadyAt                 string            `json:"readyAt,omitempty"`
	RunStartedAt            *string           `json:"runStartedAt,omitempty"`
	Suspendable             bool              `json:"suspendable"`
	OOMKills                int               `json:"oomKills"`
	LastOOM                 *OOMKill          `json:"lastOom,omitempty"`
	LastError               *APIError         `json:"lastError,omitempty"`
	AbuseLock               *MachineAbuseLock `json:"abuseLock,omitempty"`
	Queue                   *MachineQueue     `json:"queue,omitempty"`
	Spec                    MachineSpec       `json:"spec"`
	Storage                 *Storage          `json:"storage,omitempty"`
	Runtime                 *Runtime          `json:"runtime,omitempty"`
	Template                *TemplateRef      `json:"template,omitempty"`
	Metadata                map[string]string `json:"metadata,omitempty"`
	EnvNames                []string          `json:"envNames,omitempty"`
}

type MachineSpec struct {
	VCPUs             int    `json:"vcpus"`
	MemMiB            int    `json:"memMiB"`
	PersistentDiskGiB int    `json:"persistentDiskGiB,omitempty"`
	RootDiskGiB       int    `json:"rootDiskGiB,omitempty"`
	GPUs              int    `json:"gpus,omitempty"`
	GPUType           string `json:"gpuType,omitempty"`
}

type Storage struct {
	MountPath   string `json:"mountPath"`
	Persistent  bool   `json:"persistent"`
	SizeGiB     int    `json:"sizeGiB"`
	SnapshotSeq int    `json:"snapshotSeq,omitempty"`
	Synced      bool   `json:"synced"`
}

type Runtime struct {
	HostLastSeenAt     string `json:"hostLastSeenAt,omitempty"`
	HostUnreachable    bool   `json:"hostUnreachable"`
	ProcessesPreserved bool   `json:"processesPreserved"`
	Ready              bool   `json:"ready"`
}

type TemplateRef struct {
	ID      string `json:"id"`
	Version string `json:"version,omitempty"`
	Kernel  string `json:"kernel,omitempty"`
	Digest  string `json:"digest,omitempty"`
}

type OOMKill struct {
	At           string `json:"at"`
	PID          int    `json:"pid"`
	UID          int    `json:"uid,omitempty"`
	Process      string `json:"process"`
	RSSBytes     int64  `json:"rssBytes,omitempty"`
	AnonRSSBytes int64  `json:"anonRssBytes,omitempty"`
	Cgroup       bool   `json:"cgroup,omitempty"`
}

type MachineAbuseLock struct {
	At          string  `json:"at,omitempty"`
	Kind        string  `json:"kind,omitempty"`
	What        string  `json:"what,omitempty"`
	Explanation string  `json:"explanation,omitempty"`
	Appeal      string  `json:"appeal,omitempty"`
	Process     string  `json:"process,omitempty"`
	CoreShare   float64 `json:"coreShare,omitempty"`
}

type MachineQueue struct {
	ID         string `json:"id"`
	Kind       string `json:"kind"`
	State      string `json:"state"`
	Pool       string `json:"pool,omitempty"`
	Position   int    `json:"position"`
	EnqueuedAt string `json:"enqueuedAt,omitempty"`
}

// MachineMetrics mirrors GET /v1/machines/{id}/metrics.
type MachineMetrics struct {
	Disk    *MachineDisk    `json:"disk,omitempty"`
	Metrics []MachineMetric `json:"metrics"`
}

type MachineMetric struct {
	Timestamp            string  `json:"timestamp"`
	CPUCount             int     `json:"cpuCount"`
	CPUUsedPct           float64 `json:"cpuUsedPct"`
	MemUsed              int64   `json:"memUsed"`
	MemTotal             int64   `json:"memTotal"`
	DiskUsed             int64   `json:"diskUsed"`
	DiskTotal            int64   `json:"diskTotal"`
	DiskReadBytesPerSec  float64 `json:"diskReadBytesPerSec"`
	DiskWriteBytesPerSec float64 `json:"diskWriteBytesPerSec"`
	NetInBytesPerSec     float64 `json:"netInBytesPerSec"`
	NetOutBytesPerSec    float64 `json:"netOutBytesPerSec"`
	GPUCount             int     `json:"gpuCount,omitempty"`
	GPUUsedPct           float64 `json:"gpuUsedPct,omitempty"`
	GPUMemUsed           int64   `json:"gpuMemUsed,omitempty"`
	GPUMemTotal          int64   `json:"gpuMemTotal,omitempty"`
}

// MachineDisk mirrors GET /v1/machines/{id}/disk.
type MachineDisk struct {
	MeasuredAt  string              `json:"measuredAt,omitempty"`
	Filesystems []MachineFilesystem `json:"filesystems"`
	Warning     *DiskWarning        `json:"warning,omitempty"`
}

type MachineFilesystem struct {
	Mount          string  `json:"mount"`
	SizeBytes      int64   `json:"sizeBytes"`
	UsedBytes      int64   `json:"usedBytes"`
	AvailableBytes int64   `json:"availableBytes"`
	UsedPct        float64 `json:"usedPct"`
	InodesUsedPct  float64 `json:"inodesUsedPct"`
	Level          string  `json:"level"`
}

type DiskWarning struct {
	Level   string  `json:"level"`
	Mount   string  `json:"mount"`
	Message string  `json:"message"`
	NoSpace bool    `json:"noSpace"`
	UsedPct float64 `json:"usedPct"`
}

// ProcessList mirrors GET /v1/machines/{id}/processes.
type ProcessList struct {
	MachineID  string    `json:"machineId"`
	State      string    `json:"state"`
	Live       bool      `json:"live"`
	CapturedAt string    `json:"capturedAt"`
	Trigger    string    `json:"trigger,omitempty"`
	Truncated  bool      `json:"truncated"`
	Processes  []Process `json:"processes"`
}

type Process struct {
	PID            int     `json:"pid"`
	PPID           int     `json:"ppid"`
	User           string  `json:"user"`
	CPUPercent     float64 `json:"cpuPercent"`
	MemPercent     float64 `json:"memPercent"`
	ElapsedSeconds int64   `json:"elapsedSeconds"`
	Command        string  `json:"command"`
}

// MachineLogs mirrors GET /v1/machines/{id}/logs.
type MachineLogs struct {
	MachineID          string      `json:"machineId"`
	State              string      `json:"state"`
	Console            string      `json:"console"`
	ConsoleReset       bool        `json:"consoleReset"`
	ConsoleTruncated   bool        `json:"consoleTruncated"`
	ConsoleUnavailable string      `json:"consoleUnavailable,omitempty"`
	Cursor             int64       `json:"cursor"`
	Operations         []Operation `json:"operations"`
}

// Operation mirrors GET /v1/operations/{id} and 202 lifecycle mutation responses.
type Operation struct {
	ID          string    `json:"id"`
	MachineID   string    `json:"machineId"`
	Type        string    `json:"type"`
	State       string    `json:"state"` // queued, running, succeeded, failed
	Phase       string    `json:"phase,omitempty"`
	Trigger     string    `json:"trigger,omitempty"`
	Error       *APIError `json:"error,omitempty"`
	CreatedAt   string    `json:"createdAt"`
	UpdatedAt   string    `json:"updatedAt,omitempty"`
	ScheduledAt string    `json:"scheduledAt,omitempty"`
}

// PublicPortList mirrors GET /v1/ports.
type PublicPortList struct {
	Enabled bool         `json:"enabled"`
	Ports   []PublicPort `json:"ports"`
}

type PublicPort struct {
	ID        string  `json:"id"`
	MachineID string  `json:"machineId"`
	Name      string  `json:"name,omitempty"`
	Port      int     `json:"port"`
	Protocol  string  `json:"protocol"`
	Access    string  `json:"access"` // public | private
	Address   string  `json:"address,omitempty"`
	URL       string  `json:"url"`
	TokenURL  string  `json:"tokenUrl,omitempty"`
	CreatedAt string  `json:"createdAt,omitempty"`
	ExpiresAt *string `json:"expiresAt,omitempty"`
}
