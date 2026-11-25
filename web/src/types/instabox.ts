export interface AuthStatus {
  authEnabled: boolean;
  authenticated: boolean;
  username?: string;
}

export interface OrgLimits {
  alwaysOn?: boolean;
  freeSandboxes?: number;
  maxDiskGiB: number;
  maxMachines: number;
  maxRunning: number;
  maxSnapshots: number;
  maxStoredGiB: number;
  maxVCPUs: number;
}

export interface OrgUsage {
  allocatedDiskGiB: number;
  machines: number;
  freeMachines?: number;
  running: number;
  snapshots: number;
  storedBytes?: number | null;
}

export interface Org {
  id: string;
  kind: string;
  name: string;
  personal: boolean;
  role: string;
  tier: string;
  limits?: OrgLimits;
  usage?: OrgUsage;
}

export interface Account {
  id: string;
  slug?: string;
  name: string;
  baseUrl: string;
  keyHint: string;
  enabled: boolean;
  readOnly: boolean;
  writeCapable: boolean | null;
  canWrite: boolean;
  source: 'ui' | 'seed';
  userLogin: string;
  userEmail: string;
  orgs: Org[];
  lastSyncAt: string | null;
  lastSyncStatus:
    | 'pending'
    | 'ok'
    | 'auth_error'
    | 'auto_disabled'
    | 'key_error'
    | 'permission_error'
    | 'rate_limited'
    | 'error';
  lastError: string;
  consecutiveAuthFailures: number;
  maxAuthFailures: number;
  disabledReason: string;
  createdAt: string;
  updatedAt: string;
}

export interface MachineSpec {
  vcpus: number;
  memMiB: number;
  persistentDiskGiB?: number;
  rootDiskGiB?: number;
  gpus?: number;
  gpuType?: string;
}

export interface Storage {
  mountPath: string;
  persistent: boolean;
  sizeGiB: number;
  snapshotSeq?: number;
  synced: boolean;
}

export interface Runtime {
  hostLastSeenAt?: string;
  hostUnreachable: boolean;
  processesPreserved: boolean;
  ready: boolean;
}

export interface TemplateRef {
  id: string;
  version?: string;
  kernel?: string;
  digest?: string;
}

export interface OOMKill {
  at: string;
  pid: number;
  uid?: number;
  process: string;
  rssBytes?: number;
  anonRssBytes?: number;
  cgroup?: boolean;
}

export interface MachineAbuseLock {
  at?: string;
  kind?: string;
  what?: string;
  explanation?: string;
  appeal?: string;
  process?: string;
  coreShare?: number;
}

export interface APIErrorPayload {
  statusCode?: number;
  code: string;
  message: string;
  hint?: string;
  requiredScopes?: string[];
  retryAfterSeconds?: number;
}

export interface DiskWarning {
  level: 'ok' | 'high' | 'critical' | 'full';
  mount: string;
  message: string;
  noSpace: boolean;
  usedPct: number;
}

export interface VMLiveTelemetry {
  timestamp: string;
  cpuCount: number;
  cpuUsedPct: number;
  memUsed: number;
  memTotal: number;
  memUsedPct: number;
  diskUsedPct?: number;
  diskLevel?: string;
  diskWarning?: DiskWarning;
  gpuCount?: number;
  gpuUsedPct?: number;
  netInBytesPerSec?: number;
  netOutBytesPerSec?: number;
  diskReadBytesPerSec?: number;
  diskWriteBytesPerSec?: number;
}

export interface Machine {
  id: string;
  name: string;
  orgId: string;
  state: string;
  desiredState?: string;
  free: boolean;
  guestUser?: string;
  operationId?: string | null;
  autoSuspendAfterSeconds?: number | null;
  autoSuspendedAt?: string;
  cooldownReason?: string;
  cooldownUntil?: string | null;
  createdAt: string;
  updatedAt?: string;
  readyAt?: string;
  runStartedAt?: string | null;
  suspendable: boolean;
  oomKills: number;
  lastOom?: OOMKill;
  lastError?: APIErrorPayload;
  abuseLock?: MachineAbuseLock;
  spec: MachineSpec;
  storage?: Storage;
  runtime?: Runtime;
  template?: TemplateRef;
  metadata?: Record<string, string>;
  envNames?: string[];
}

export interface FleetMachine extends Machine {
  accountId: string;
  accountName: string;
  accountSource: 'ui' | 'seed';
  accountStatus: string;
  orgName: string;
  canWrite: boolean;
  readOnly: boolean;
  liveMetrics?: VMLiveTelemetry;
  portsCount: number;
  snapshotStale: boolean;
  snapshotAt?: string;
}

export interface FleetSummary {
  totalVMs: number;
  runningVMs: number;
  suspendedVMs: number;
  stoppedVMs: number;
  transitioningVMs: number;
  errorVMs: number;
  totalAccounts: number;
  healthyAccounts: number;
  degradedAccounts: number;
  autoDisabledAccounts: number;
  keyErrorAccounts: number;
  runningVCPUs: number;
  runningMemMiB: number;
  totalVCPUs: number;
  totalMemMiB: number;
  totalDiskGiB: number;
  alertCount: number;
  oomAlertCount: number;
  diskAlertCount: number;
  lockAlertCount: number;
  unreachableCount: number;
}

export interface FleetResponse {
  summary: FleetSummary;
  accounts: Account[];
  machines: FleetMachine[];
  pollIntervalSeconds: number;
  metricsPollIntervalSeconds: number;
  generatedAt: string;
}

export interface MachineMetricSample {
  timestamp: string;
  cpuCount: number;
  cpuUsedPct: number;
  memUsed: number;
  memTotal: number;
  diskUsed: number;
  diskTotal: number;
  diskReadBytesPerSec: number;
  diskWriteBytesPerSec: number;
  netInBytesPerSec: number;
  netOutBytesPerSec: number;
  gpuCount?: number;
  gpuUsedPct?: number;
  gpuMemUsed?: number;
  gpuMemTotal?: number;
}

export interface MachineFilesystem {
  mount: string;
  sizeBytes: number;
  usedBytes: number;
  availableBytes: number;
  usedPct: number;
  inodesUsedPct: number;
  level: 'ok' | 'high' | 'critical' | 'full';
}

export interface MachineDisk {
  measuredAt?: string;
  filesystems: MachineFilesystem[];
  warning?: DiskWarning;
}

export interface MachineMetricsResponse {
  disk?: MachineDisk;
  metrics: MachineMetricSample[];
}

export interface ProcessItem {
  pid: number;
  ppid: number;
  user: string;
  cpuPercent: number;
  memPercent: number;
  elapsedSeconds: number;
  command: string;
}

export interface ProcessListResponse {
  machineId: string;
  state: string;
  live: boolean;
  capturedAt: string;
  trigger?: string;
  truncated: boolean;
  processes: ProcessItem[];
}

export interface Operation {
  id: string;
  machineId: string;
  type: string;
  state: 'queued' | 'running' | 'succeeded' | 'failed';
  phase?: string;
  trigger?: string;
  error?: APIErrorPayload;
  createdAt: string;
  updatedAt?: string;
}

export interface MachineLogsResponse {
  machineId: string;
  state: string;
  console: string;
  consoleReset: boolean;
  consoleTruncated: boolean;
  consoleUnavailable?: string;
  cursor: number;
  operations: Operation[];
}

export interface PublicPort {
  id: string;
  machineId: string;
  name?: string;
  port: number;
  protocol: string;
  access: 'public' | 'private';
  address?: string;
  url: string;
  token?: string;
  tokenUrl?: string;
  createdAt?: string;
  expiresAt?: string | null;
  accountId?: string;
  accountName?: string;
  orgId?: string;
  orgName?: string;
  machineName?: string;
  machineState?: string;
  canWrite?: boolean;
  readOnly?: boolean;
}

export interface PublicPortListResponse {
  enabled: boolean;
  ports: PublicPort[];
}

export interface PublishPortPayload {
  port: number;
  name?: string;
  protocol?: 'http' | 'tcp';
  access?: 'public' | 'private';
  rotateToken?: boolean;
  machineName?: string;
}

export interface ActivityEvent {
  id: number;
  accountId: string;
  machineId?: string;
  machineName?: string;
  eventType: string;
  detail: string;
  createdAt: string;
}

export interface WakeAllResultItem {
  accountId: string;
  accountName: string;
  machineId: string;
  machineName: string;
  action: 'start' | 'resume';
  operationId?: string;
  status: 'triggered' | 'skipped' | 'failed';
  error?: string;
}

export interface WakeAllResponse {
  total: number;
  triggered: number;
  skipped: number;
  failed: number;
  results: WakeAllResultItem[];
}

export interface BulkAccountResultItem {
  index: number;
  name: string;
  keyHint?: string;
  accountId?: string;
  status: 'created' | 'skipped' | 'failed';
  reason?: string;
}

export interface BulkCreateAccountsResponse {
  total: number;
  created: number;
  skipped: number;
  failed: number;
  results: BulkAccountResultItem[];
}

export interface SSEEvent {
  type: 'connected' | 'fleet_updated' | 'account_updated' | 'operation_updated';
  accountId?: string;
  machineId?: string;
  payload?: Operation;
  timestamp: string;
}
