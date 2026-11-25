import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  Globe,
  HardDrive,
  KeyRound,
  Loader2,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Terminal,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LifecycleControls } from '../components/LifecycleControls';
import { MetricCharts } from '../components/MetricCharts';
import {
  PublishPortModal,
  RotateTokenModal,
  TokenRevealModal,
  UnpublishPortModal,
} from '../components/PublishPortModal';
import { VMStateBadge, VMWarningBadges } from '../components/StateBadge';
import { api, ApiError } from '../lib/api';
import { formatBytes, formatDurationSeconds, formatMemMiB, formatRelativeTime, formatUptime } from '../lib/format';
import type {
  Account,
  Machine,
  MachineDisk,
  MachineLogsResponse,
  MachineMetricsResponse,
  Operation,
  ProcessListResponse,
  PublicPort,
} from '../types/instabox';

type DetailTab = 'metrics' | 'disk' | 'processes' | 'logs' | 'ports';
const TIME_RANGES = ['15m', '1h', '6h', '24h'] as const;

export function VMDetailPage({
  activeOps,
  onOperationStarted,
  onFleetRefresh,
}: {
  activeOps: Record<string, Operation>;
  onOperationStarted: (accountId: string, machineId: string, op: Operation) => void;
  onFleetRefresh?: () => Promise<void> | void;
}) {
  const { accountId = '', machineId = '' } = useParams();
  const [tab, setTab] = useState<DetailTab>('metrics');
  const [since, setSince] = useState<(typeof TIME_RANGES)[number]>('1h');

  const [account, setAccount] = useState<Account | null>(null);
  const [vm, setVM] = useState<Machine | null>(null);
  const [ports, setPorts] = useState<PublicPort[]>([]);
  const [portsEnabled, setPortsEnabled] = useState<boolean | null>(null);
  const [metrics, setMetrics] = useState<MachineMetricsResponse | null>(null);
  const [disk, setDisk] = useState<MachineDisk | null>(null);
  const [processes, setProcesses] = useState<ProcessListResponse | null>(null);
  const [logs, setLogs] = useState<MachineLogsResponse | null>(null);

  const [loading, setLoading] = useState(true);
  const [tabLoading, setTabLoading] = useState(false);
  const [error, setError] = useState('');
  const [procSearch, setProcSearch] = useState('');
  const [copiedId, setCopiedId] = useState(false);
  const [copiedConsole, setCopiedConsole] = useState(false);
  const [copiedPortKey, setCopiedPortKey] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [editingPort, setEditingPort] = useState<PublicPort | null>(null);
  const [rotateTarget, setRotateTarget] = useState<{
    accountId: string;
    machineId: string;
    machineName?: string;
    port: PublicPort;
  } | null>(null);
  const [unpublishTarget, setUnpublishTarget] = useState<{
    accountId: string;
    machineId: string;
    machineName?: string;
    port: PublicPort;
  } | null>(null);
  const [revealedPort, setRevealedPort] = useState<PublicPort | null>(null);
  const consoleRef = useRef<HTMLPreElement | null>(null);

  const opKey = `${accountId}:${machineId}`;
  const activeOp = activeOps[opKey];

  const loadVM = useCallback(async () => {
    if (!accountId || !machineId) return;
    try {
      const res = await api.getVM(accountId, machineId);
      setAccount(res.account);
      setVM(res.machine);
      setPorts(res.ports ?? []);
      setError('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load sandbox details');
    } finally {
      setLoading(false);
    }
  }, [accountId, machineId]);

  const loadTabData = useCallback(
    async (targetTab: DetailTab, range: string) => {
      if (!accountId || !machineId) return;
      setTabLoading(true);
      try {
        if (targetTab === 'metrics') {
          const res = await api.getVMMetrics(accountId, machineId, range);
          setMetrics(res);
          if (res.disk) setDisk(res.disk);
        } else if (targetTab === 'disk') {
          const res = await api.getVMDisk(accountId, machineId);
          setDisk(res);
        } else if (targetTab === 'processes') {
          const res = await api.getVMProcesses(accountId, machineId);
          setProcesses(res);
        } else if (targetTab === 'logs') {
          const res = await api.getVMLogs(accountId, machineId, 300, 0);
          setLogs(res);
          setTimeout(() => {
            if (consoleRef.current) consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
          }, 50);
        } else if (targetTab === 'ports') {
          const res = await api.listMachinePorts(accountId, machineId);
          setPorts(res.ports ?? []);
          setPortsEnabled(res.enabled);
        }
      } catch (err) {
        if (targetTab !== 'disk') {
          setError(err instanceof ApiError ? err.message : `Failed to load ${targetTab}`);
        }
      } finally {
        setTabLoading(false);
      }
    },
    [accountId, machineId],
  );

  const refreshMachinePorts = useCallback(async () => {
    if (!accountId || !machineId) return;
    try {
      const res = await api.listMachinePorts(accountId, machineId);
      setPorts(res.ports ?? []);
      setPortsEnabled(res.enabled);
    } catch {
      // Fallback handled cleanly by loadVM/fleet sync
    }
    await onFleetRefresh?.();
  }, [accountId, machineId, onFleetRefresh]);

  const copyPortText = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedPortKey(key);
      setTimeout(() => setCopiedPortKey((prev) => (prev === key ? null : prev)), 1500);
    } catch {
      // Ignore clipboard failures
    }
  };

  useEffect(() => {
    void loadVM();
  }, [loadVM]);

  useEffect(() => {
    if (tab !== 'ports') {
      void loadTabData(tab, since);
    }
  }, [tab, since, loadTabData]);

  // Refresh VM header whenever tracked operation completes
  useEffect(() => {
    if (activeOp && (activeOp.state === 'succeeded' || activeOp.state === 'failed')) {
      void loadVM();
      if (tab === 'logs') void loadTabData('logs', since);
    }
  }, [activeOp, loadVM, loadTabData, tab, since]);

  const filteredProcs = useMemo(() => {
    const q = procSearch.trim().toLowerCase();
    const list = processes?.processes ?? [];
    if (!q) return list;
    return list.filter(
      (p) =>
        p.command.toLowerCase().includes(q) ||
        p.user.toLowerCase().includes(q) ||
        String(p.pid).includes(q),
    );
  }, [processes, procSearch]);

  const copyText = (txt: string, cb: (v: boolean) => void) => {
    void navigator.clipboard.writeText(txt);
    cb(true);
    setTimeout(() => cb(false), 1500);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-slate-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading sandbox...
      </div>
    );
  }

  if (!vm || !account) {
    return (
      <div className="space-y-3">
        <Link to="/" className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-500 hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Fleet
        </Link>
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-500">
          {error || 'Sandbox not found'}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Link to="/" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-sky-500 dark:text-slate-400">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Fleet
        </Link>
        <button
          type="button"
          onClick={() => {
            void loadVM();
            if (tab !== 'ports') void loadTabData(tab, since);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium hover:bg-slate-100 dark:border-slate-800 dark:hover:bg-slate-800"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${tabLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Header Card */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/70">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-bold">{vm.name}</h1>
              <VMStateBadge state={vm.state} />
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {account.name}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-xs text-slate-500 dark:text-slate-400">
              <button
                type="button"
                onClick={() => copyText(vm.id, setCopiedId)}
                className="inline-flex items-center gap-1 hover:text-sky-500"
                title="Copy sandbox ID"
              >
                {vm.id}
                {copiedId ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
              </button>
              <span>·</span>
              <span>{vm.spec.vcpus} vCPU</span>
              <span>·</span>
              <span>{formatMemMiB(vm.spec.memMiB)} RAM</span>
              {vm.storage?.sizeGiB ? (
                <>
                  <span>·</span>
                  <span>{vm.storage.sizeGiB} GiB /data</span>
                </>
              ) : null}
              {vm.state === 'running' && (
                <>
                  <span>·</span>
                  <span>Uptime {formatUptime(vm.runStartedAt)}</span>
                </>
              )}
            </div>
            <VMWarningBadges vm={vm} />
          </div>

          <LifecycleControls
            accountId={account.id}
            machineId={vm.id}
            machineName={vm.name}
            state={vm.state}
            canWrite={account.canWrite}
            activeOperation={activeOp}
            onOperationStarted={(op) => onOperationStarted(account.id, vm.id, op)}
            onError={(msg) => setError(msg)}
          />
        </div>

        {/* Live Operation Progress Tracker Banner */}
        {activeOp && (
          <div
            className={`mt-3 flex items-center justify-between rounded-lg border px-3 py-2 text-xs ${
              activeOp.state === 'failed'
                ? 'border-rose-500/30 bg-rose-500/10 text-rose-500'
                : activeOp.state === 'succeeded'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400'
            }`}
          >
            <div className="flex items-center gap-2 font-mono">
              {(activeOp.state === 'queued' || activeOp.state === 'running') && (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              )}
              <span>
                Operation {activeOp.type} ({activeOp.id}): <strong>{activeOp.state}</strong>
                {activeOp.phase ? ` — ${activeOp.phase}` : ''}
              </span>
            </div>
            {activeOp.error?.message && <span>{activeOp.error.message}</span>}
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-500">
            {error}
          </div>
        )}

        {/* Sub-navigation Tabs */}
        <div className="mt-4 flex gap-5 overflow-x-auto border-b border-slate-200 dark:border-slate-800">
          {(
            [
              ['metrics', 'Metrics'],
              ['disk', 'Disk & Storage'],
              ['processes', 'Processes'],
              ['logs', 'Console Logs & Ops'],
              ['ports', `Ports & Details (${ports.length})`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`whitespace-nowrap border-b-2 pb-2.5 text-xs font-semibold transition-colors ${
                tab === id
                  ? 'border-sky-500 text-sky-600 dark:text-sky-400'
                  : 'border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* TAB 1: METRICS */}
      {tab === 'metrics' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              30-second host telemetry samples
            </span>
            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 dark:border-slate-800 dark:bg-slate-900">
              {TIME_RANGES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setSince(r)}
                  className={`rounded-md px-2.5 py-1 font-mono text-xs font-medium ${
                    since === r
                      ? 'bg-sky-600 text-white'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <MetricCharts samples={metrics?.metrics ?? []} />
        </div>
      )}

      {/* TAB 2: DISK & STORAGE */}
      {tab === 'disk' && (
        <div className="space-y-4">
          {disk?.warning && disk.warning.level !== 'ok' && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                <strong>{disk.warning.mount}</strong> ({disk.warning.level}): {disk.warning.message}
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {(disk?.filesystems ?? []).length === 0 ? (
              <div className="col-span-full rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/70">
                Live disk usage is only available while the sandbox is running.
              </div>
            ) : (
              disk!.filesystems.map((fs) => {
                const barColor =
                  fs.level === 'full' || fs.level === 'critical'
                    ? 'bg-rose-500'
                    : fs.level === 'high'
                      ? 'bg-amber-500'
                      : 'bg-sky-500';
                return (
                  <div
                    key={fs.mount}
                    className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/70"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 font-mono text-sm font-semibold">
                        <HardDrive className="h-4 w-4 text-sky-500" />
                        {fs.mount}
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ${
                          fs.level === 'ok'
                            ? 'bg-emerald-500/15 text-emerald-500'
                            : fs.level === 'high'
                              ? 'bg-amber-500/15 text-amber-500'
                              : 'bg-rose-500/15 text-rose-500'
                        }`}
                      >
                        {fs.level}
                      </span>
                    </div>
                    <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                      <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(100, fs.usedPct)}%` }} />
                    </div>
                    <div className="mt-2.5 grid grid-cols-2 gap-2 font-mono text-xs text-slate-600 dark:text-slate-300">
                      <div>Used: {formatBytes(fs.usedBytes)} ({fs.usedPct.toFixed(1)}%)</div>
                      <div className="text-right">Free: {formatBytes(fs.availableBytes)}</div>
                      <div>Total: {formatBytes(fs.sizeBytes)}</div>
                      <div className="text-right">Inodes: {fs.inodesUsedPct.toFixed(1)}%</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {vm.storage && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs dark:border-slate-800 dark:bg-slate-900/70">
              <h3 className="mb-2 font-semibold">Storage Volume Metadata</h3>
              <div className="grid grid-cols-2 gap-2 font-mono sm:grid-cols-4">
                <div>Mount: {vm.storage.mountPath}</div>
                <div>Size: {vm.storage.sizeGiB} GiB</div>
                <div>Persistent: {vm.storage.persistent ? 'Yes' : 'No'}</div>
                <div>Synced: {vm.storage.synced ? 'Yes' : 'No'}</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: PROCESSES */}
      {tab === 'processes' && (
        <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/70">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 p-3 dark:border-slate-800">
            <div className="flex items-center gap-2 text-xs">
              <span
                className={`rounded-full px-2 py-0.5 font-semibold ${
                  processes?.live
                    ? 'bg-emerald-500/15 text-emerald-500'
                    : 'bg-slate-500/15 text-slate-500 dark:text-slate-400'
                }`}
              >
                {processes?.live ? 'Live' : 'Last-Seen'}
              </span>
              {processes?.capturedAt && (
                <span className="text-slate-500">Captured {formatRelativeTime(processes.capturedAt)}</span>
              )}
            </div>
            <input
              type="text"
              value={procSearch}
              onChange={(e) => setProcSearch(e.target.value)}
              placeholder="Filter command, user, PID..."
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1 text-xs outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] text-slate-500 dark:border-slate-800">
                  <th className="px-3 py-2">PID</th>
                  <th className="px-3 py-2">PPID</th>
                  <th className="px-3 py-2">USER</th>
                  <th className="px-3 py-2 text-right">CPU%</th>
                  <th className="px-3 py-2 text-right">MEM%</th>
                  <th className="px-3 py-2 text-right">ELAPSED</th>
                  <th className="px-3 py-2">COMMAND</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {filteredProcs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center font-sans text-slate-400">
                      No processes available.
                    </td>
                  </tr>
                ) : (
                  filteredProcs.map((p) => (
                    <tr key={p.pid} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="px-3 py-1.5">{p.pid}</td>
                      <td className="px-3 py-1.5 text-slate-500">{p.ppid}</td>
                      <td className="px-3 py-1.5">{p.user}</td>
                      <td className="px-3 py-1.5 text-right">{p.cpuPercent.toFixed(1)}%</td>
                      <td className="px-3 py-1.5 text-right">{p.memPercent.toFixed(1)}%</td>
                      <td className="px-3 py-1.5 text-right text-slate-500">{formatDurationSeconds(p.elapsedSeconds)}</td>
                      <td className="max-w-md truncate px-3 py-1.5" title={p.command}>
                        {p.command}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: CONSOLE LOGS & RECENT OPERATIONS */}
      {tab === 'logs' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/70 lg:col-span-2">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5 text-xs dark:border-slate-800">
              <div className="flex items-center gap-2 font-semibold">
                <Terminal className="h-4 w-4 text-sky-500" />
                Serial Console Log
              </div>
              <button
                type="button"
                onClick={() => copyText(logs?.console ?? '', setCopiedConsole)}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                {copiedConsole ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                Copy
              </button>
            </div>
            <pre
              ref={consoleRef}
              className="h-96 overflow-auto bg-slate-950 p-4 font-mono text-[11px] leading-relaxed text-slate-200"
            >
              {logs?.consoleUnavailable
                ? `Console unavailable: ${logs.consoleUnavailable}`
                : logs?.console || '(no console output)'}
            </pre>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/70">
            <div className="border-b border-slate-200 px-4 py-2.5 text-xs font-semibold dark:border-slate-800">
              Recent Operations ({logs?.operations.length ?? 0})
            </div>
            <div className="max-h-96 divide-y divide-slate-200 overflow-y-auto text-xs dark:divide-slate-800">
              {(logs?.operations ?? []).length === 0 ? (
                <div className="p-6 text-center text-slate-400">No operations recorded.</div>
              ) : (
                [...(logs?.operations ?? [])].reverse().map((op) => (
                  <div key={op.id} className="p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-semibold">{op.type}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          op.state === 'succeeded'
                            ? 'bg-emerald-500/15 text-emerald-500'
                            : op.state === 'failed'
                              ? 'bg-rose-500/15 text-rose-500'
                              : 'bg-sky-500/15 text-sky-500'
                        }`}
                      >
                        {op.state}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
                      <span>trigger: {op.trigger || 'request'}</span>
                      <span>{formatRelativeTime(op.createdAt)}</span>
                    </div>
                    {op.error?.message && (
                      <div className="mt-1 rounded bg-rose-500/10 p-1.5 font-mono text-[10px] text-rose-500">
                        {op.error.code}: {op.error.message}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: PORTS & METADATA DETAILS */}
      {tab === 'ports' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs dark:border-slate-800 dark:bg-slate-900/70">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">Exposed Ports ({ports.length} / 16)</h3>
                <Link
                  to={`/ports?account=${encodeURIComponent(accountId)}&vm=${encodeURIComponent(machineId)}`}
                  className="text-[11px] font-medium text-sky-600 hover:underline dark:text-sky-400"
                >
                  Manage in Ports →
                </Link>
              </div>
              <button
                type="button"
                disabled={!account?.canWrite || ports.length >= 16}
                title={
                  !account?.canWrite
                    ? 'Account is disabled, read-only, or lacks machines:write scope'
                    : ports.length >= 16
                      ? 'Maximum 16 exposed ports reached'
                      : 'Publish a new port on this VM'
                }
                onClick={() => {
                  setEditingPort(null);
                  setPublishOpen(true);
                }}
                className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Plus className="h-3.5 w-3.5" />
                Publish Port
              </button>
            </div>

            {portsEnabled === false && (
              <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-700 dark:text-amber-300">
                Port publishing is not enabled for this sandbox plan.
              </div>
            )}

            {vm.state !== 'running' && ports.length > 0 && (
              <div className="mb-3 flex items-center gap-1.5 rounded-lg border border-sky-500/25 bg-sky-500/10 p-2 text-[11px] text-sky-700 dark:text-sky-300">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-sky-500" />
                Sandbox is {vm.state}; exposed endpoints return HTTP 503 until running.
              </div>
            )}

            {ports.length === 0 ? (
              <p className="text-slate-500">No public or private ports exposed on this sandbox.</p>
            ) : (
              <div className="space-y-2.5">
                {ports.map((p) => {
                  const endpoint = p.address || p.url;
                  const canWrite = Boolean(account?.canWrite);
                  return (
                    <div
                      key={`${p.id}-${p.port}`}
                      className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5 font-mono">
                          <span className="font-semibold text-slate-900 dark:text-slate-100">:{p.port}</span>
                          {p.name && (
                            <span className="font-sans font-semibold text-slate-700 dark:text-slate-300">
                              {p.name}
                            </span>
                          )}
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase dark:bg-slate-800">
                            {p.protocol}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] uppercase ${
                              p.access === 'public'
                                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                            }`}
                          >
                            {p.access === 'private' ? (
                              <Lock className="h-2.5 w-2.5" />
                            ) : (
                              <Globe className="h-2.5 w-2.5" />
                            )}
                            {p.access}
                          </span>
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={!canWrite}
                            title={canWrite ? 'Edit name or access' : 'Read-only account'}
                            onClick={() => {
                              setEditingPort(p);
                              setPublishOpen(true);
                            }}
                            className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-[11px] font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-45 dark:border-slate-700 dark:hover:bg-slate-800"
                          >
                            <Pencil className="h-3 w-3" />
                            Edit
                          </button>
                          {p.access === 'private' && (
                            <button
                              type="button"
                              disabled={!canWrite}
                              title={canWrite ? 'Rotate private token' : 'Read-only account'}
                              onClick={() =>
                                setRotateTarget({
                                  accountId,
                                  machineId,
                                  machineName: vm.name,
                                  port: p,
                                })
                              }
                              className="inline-flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-700 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-45 dark:text-amber-300"
                            >
                              <KeyRound className="h-3 w-3" />
                              Rotate
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={!canWrite}
                            title={canWrite ? 'Unpublish port' : 'Read-only account'}
                            onClick={() =>
                              setUnpublishTarget({
                                accountId,
                                machineId,
                                machineName: vm.name,
                                port: p,
                              })
                            }
                            className="inline-flex items-center gap-1 rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[11px] font-medium text-rose-600 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-45 dark:text-rose-400"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        {p.url ? (
                          <a
                            href={p.url}
                            target="_blank"
                            rel="noreferrer"
                            className="truncate font-mono text-[11px] text-sky-600 hover:underline dark:text-sky-400"
                          >
                            {p.url}
                          </a>
                        ) : (
                          <span className="font-mono text-[11px]">{endpoint}</span>
                        )}
                        <button
                          type="button"
                          onClick={() => void copyPortText(`${p.id}-${p.port}`, endpoint)}
                          className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                          title={p.address ? 'Copy SNI address' : 'Copy URL'}
                        >
                          {copiedPortKey === `${p.id}-${p.port}` ? (
                            <Check className="h-3 w-3 text-emerald-500" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </button>
                        {p.url && (
                          <a
                            href={p.url}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                            title="Open URL"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                        {p.address && (
                          <span className="rounded bg-indigo-500/10 px-1.5 py-0.5 font-mono text-[10px] text-indigo-600 dark:text-indigo-400">
                            SNI: {p.address}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs dark:border-slate-800 dark:bg-slate-900/70">
              <h3 className="mb-3 font-semibold">Sandbox Metadata &amp; Runtime</h3>
              <dl className="grid grid-cols-2 gap-y-2 font-mono">
                <dt className="text-slate-500">Template</dt>
                <dd>{vm.template?.id || '—'} {vm.template?.version || ''}</dd>
                <dt className="text-slate-500">Kernel</dt>
                <dd>{vm.template?.kernel || '—'}</dd>
                <dt className="text-slate-500">Auto-Suspend</dt>
                <dd>{vm.autoSuspendAfterSeconds ? `${vm.autoSuspendAfterSeconds}s` : 'Disabled'}</dd>
                <dt className="text-slate-500">Created</dt>
                <dd>{formatRelativeTime(vm.createdAt)}</dd>
                <dt className="text-slate-500">Host Reachable</dt>
                <dd>{vm.runtime?.hostUnreachable ? 'No' : 'Yes'}</dd>
                <dt className="text-slate-500">Processes Preserved</dt>
                <dd>{vm.runtime?.processesPreserved ? 'Yes' : 'No'}</dd>
              </dl>

              {vm.metadata && Object.keys(vm.metadata).length > 0 && (
                <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-800">
                  <div className="mb-2 font-sans font-semibold text-slate-500">Labels</div>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(vm.metadata).map(([k, v]) => (
                      <span
                        key={k}
                        className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] dark:bg-slate-800"
                      >
                        {k}={v}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {(vm.lastOom || vm.lastError || vm.abuseLock) && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-xs">
                <h3 className="mb-2 font-semibold text-rose-500">Diagnostics</h3>
                {vm.lastOom && (
                  <div className="mb-2 font-mono">
                    Last OOM: <strong>{vm.lastOom.process}</strong> (PID {vm.lastOom.pid}) at{' '}
                    {formatRelativeTime(vm.lastOom.at)} ({formatBytes(vm.lastOom.rssBytes)} RSS)
                  </div>
                )}
                {vm.lastError && (
                  <div className="mb-2 font-mono text-rose-400">
                    Last Error: {vm.lastError.code} — {vm.lastError.message}
                  </div>
                )}
                {vm.abuseLock && (
                  <div className="font-mono text-rose-400">
                    Abuse Lock ({vm.abuseLock.kind}): {vm.abuseLock.explanation || vm.abuseLock.what}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <PublishPortModal
        isOpen={publishOpen}
        onClose={() => {
          setPublishOpen(false);
          setEditingPort(null);
        }}
        fixedTarget={{
          accountId,
          accountName: account?.name || accountId,
          machineId,
          machineName: vm.name,
          machineState: vm.state,
          portsCount: ports.length,
          canWrite: Boolean(account?.canWrite),
        }}
        editingPort={editingPort}
        onPublished={() => void refreshMachinePorts()}
      />

      <RotateTokenModal
        target={rotateTarget}
        onClose={() => setRotateTarget(null)}
        onRotated={(updated) => {
          setRotateTarget(null);
          setRevealedPort(updated);
          void refreshMachinePorts();
        }}
      />

      <UnpublishPortModal
        target={unpublishTarget}
        onClose={() => setUnpublishTarget(null)}
        onUnpublished={() => {
          setUnpublishTarget(null);
          void refreshMachinePorts();
        }}
      />

      <TokenRevealModal
        port={revealedPort}
        machineName={vm.name}
        onClose={() => setRevealedPort(null)}
      />
    </div>
  );
}
