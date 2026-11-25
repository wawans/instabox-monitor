import {
  AlertTriangle,
  ArrowUpDown,
  ChevronRight,
  Cpu,
  Globe,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Server,
  ShieldAlert,
  Zap,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { LifecycleControls } from '../components/LifecycleControls';
import { MetricBar } from '../components/MetricBar';
import { VMStateBadge, VMWarningBadges } from '../components/StateBadge';
import { api, ApiError } from '../lib/api';
import { formatMemMiB, formatRelativeTime, formatUptime } from '../lib/format';
import type { FleetMachine, FleetResponse, Operation, WakeAllResponse } from '../types/instabox';

type SortField = 'name' | 'state' | 'cpu' | 'ram' | 'disk';

export function FleetPage({
  fleet,
  loading,
  activeOps,
  onOperationStarted,
  onRefresh,
}: {
  fleet: FleetResponse | null;
  loading: boolean;
  activeOps: Record<string, Operation>;
  onOperationStarted: (accountId: string, machineId: string, op: Operation) => void;
  onRefresh: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const selectedAccount = searchParams.get('account') ?? '';
  const selectedOrg = searchParams.get('org') ?? '';
  const selectedState = searchParams.get('state') ?? '';
  const search = searchParams.get('q') ?? '';

  const [sortField, setSortField] = useState<SortField>('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const [wakeModalOpen, setWakeModalOpen] = useState(false);
  const [wakingAll, setWakingAll] = useState(false);
  const [wakeResult, setWakeResult] = useState<WakeAllResponse | null>(null);

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  };

  const accounts = fleet?.accounts ?? [];
  const allMachines = fleet?.machines ?? [];

  const orgOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of allMachines) {
      if (selectedAccount && m.accountId !== selectedAccount) continue;
      if (m.orgId) map.set(m.orgId, m.orgName || m.orgId);
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [allMachines, selectedAccount]);

  const filteredMachines = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = allMachines.filter((m) => {
      if (selectedAccount && m.accountId !== selectedAccount) return false;
      if (selectedOrg && m.orgId !== selectedOrg) return false;
      if (selectedState) {
        if (selectedState === 'transitioning') {
          if (['running', 'suspended', 'stopped', 'error'].includes(m.state)) return false;
        } else if (m.state !== selectedState) {
          return false;
        }
      }
      if (q) {
        const hay = [
          m.name,
          m.id,
          m.accountName,
          m.orgName,
          m.template?.id ?? '',
          ...Object.entries(m.metadata ?? {}).map(([k, v]) => `${k}=${v}`),
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const dir = sortAsc ? 1 : -1;
    return [...list].sort((a, b) => {
      switch (sortField) {
        case 'state':
          return a.state.localeCompare(b.state) * dir;
        case 'cpu':
          return ((a.liveMetrics?.cpuUsedPct ?? -1) - (b.liveMetrics?.cpuUsedPct ?? -1)) * dir;
        case 'ram':
          return ((a.liveMetrics?.memUsedPct ?? -1) - (b.liveMetrics?.memUsedPct ?? -1)) * dir;
        case 'disk':
          return ((a.liveMetrics?.diskUsedPct ?? -1) - (b.liveMetrics?.diskUsedPct ?? -1)) * dir;
        default:
          return a.name.localeCompare(b.name) * dir;
      }
    });
  }, [allMachines, selectedAccount, selectedOrg, selectedState, search, sortField, sortAsc]);

  // Wake All targets follow the currently active Fleet filter!
  const wakeCandidates = useMemo(() => {
    const writable: FleetMachine[] = [];
    const readOnlySkipped: FleetMachine[] = [];
    for (const m of filteredMachines) {
      if (m.state !== 'stopped' && m.state !== 'suspended') continue;
      if (m.canWrite) writable.push(m);
      else readOnlySkipped.push(m);
    }
    return {
      writable,
      readOnlySkipped,
      stoppedCount: writable.filter((m) => m.state === 'stopped').length,
      suspendedCount: writable.filter((m) => m.state === 'suspended').length,
    };
  }, [filteredMachines]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortAsc((v) => !v);
    else {
      setSortField(field);
      setSortAsc(field === 'name');
    }
  };

  const handleSyncAll = async () => {
    setSyncing(true);
    try {
      await api.syncAll();
      await onRefresh();
      setToast({ kind: 'ok', text: 'Triggered immediate sync for all enabled accounts.' });
    } catch (err) {
      setToast({ kind: 'err', text: err instanceof ApiError ? err.message : 'Sync failed' });
    } finally {
      setSyncing(false);
    }
  };

  const handleConfirmWakeAll = async () => {
    setWakingAll(true);
    try {
      const res = await api.wakeAll({
        accountId: selectedAccount || undefined,
        orgId: selectedOrg || undefined,
        search: search.trim() || undefined,
        machineIds: filteredMachines.map((m) => m.id),
      });
      setWakeResult(res);
      await onRefresh();
    } catch (err) {
      setToast({ kind: 'err', text: err instanceof ApiError ? err.message : 'Wake All failed' });
      setWakeModalOpen(false);
    } finally {
      setWakingAll(false);
    }
  };

  const summary = fleet?.summary;
  const activeAccountObj = accounts.find((a) => a.id === selectedAccount);
  const wakeScopeLabel = activeAccountObj ? `in ${activeAccountObj.name}` : 'All Filtered VMs';

  return (
    <div className="space-y-4">
      {toast && (
        <div
          className={`flex items-center justify-between rounded-xl border px-4 py-2.5 text-xs ${
            toast.kind === 'ok'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
          }`}
        >
          <span>{toast.text}</span>
          <button type="button" onClick={() => setToast(null)} className="ml-4 font-semibold underline">
            Dismiss
          </button>
        </div>
      )}

      {/* KPI Summary Strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/70">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Running VMs</span>
            <Server className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="mt-1.5 flex items-baseline gap-1.5 font-mono">
            <span className="text-2xl font-bold">{summary?.runningVMs ?? 0}</span>
            <span className="text-sm text-slate-400">/ {summary?.totalVMs ?? 0}</span>
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {summary?.suspendedVMs ?? 0} suspended · {summary?.stoppedVMs ?? 0} stopped
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/70">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Active Accounts</span>
            <ShieldAlert
              className={`h-4 w-4 ${(summary?.degradedAccounts ?? 0) > 0 ? 'text-rose-500' : 'text-sky-500'}`}
            />
          </div>
          <div className="mt-1.5 flex items-baseline gap-1.5 font-mono">
            <span className="text-2xl font-bold">{summary?.healthyAccounts ?? 0}</span>
            <span className="text-sm text-slate-400">/ {summary?.totalAccounts ?? 0}</span>
          </div>
          <div className="mt-1 text-xs">
            {(summary?.autoDisabledAccounts ?? 0) > 0 ? (
              <span className="text-rose-600 dark:text-rose-400">
                {summary?.autoDisabledAccounts} auto-disabled (401)
              </span>
            ) : (summary?.keyErrorAccounts ?? 0) > 0 ? (
              <span className="text-amber-600 dark:text-amber-400">{summary?.keyErrorAccounts} key error</span>
            ) : (
              <span className="text-slate-500 dark:text-slate-400">All enabled accounts healthy</span>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/70">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Active Compute</span>
            <Cpu className="h-4 w-4 text-sky-500" />
          </div>
          <div className="mt-1.5 font-mono text-2xl font-bold">{summary?.runningVCPUs ?? 0} vCPU</div>
          <div className="mt-1 font-mono text-xs text-slate-500 dark:text-slate-400">
            {formatMemMiB(summary?.runningMemMiB ?? 0)} RAM · {summary?.totalDiskGiB ?? 0} GiB Disk
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/70">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Active Alerts</span>
            <AlertTriangle
              className={`h-4 w-4 ${(summary?.alertCount ?? 0) > 0 ? 'text-amber-500' : 'text-slate-400'}`}
            />
          </div>
          <div
            className={`mt-1.5 font-mono text-2xl font-bold ${
              (summary?.alertCount ?? 0) > 0 ? 'text-amber-500' : ''
            }`}
          >
            {summary?.alertCount ?? 0}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {summary?.diskAlertCount ?? 0} disk · {summary?.oomAlertCount ?? 0} OOM · {summary?.lockAlertCount ?? 0} lock
          </div>
        </div>
      </div>

      {/* Multi-Account Filter Chips */}
      {accounts.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => updateParam('account', '')}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              selectedAccount === ''
                ? 'border-sky-500 bg-sky-500/15 text-sky-600 dark:text-sky-300'
                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
            }`}
          >
            All Accounts
            <span className="rounded bg-slate-200/80 px-1.5 py-0.2 font-mono text-[10px] dark:bg-slate-800">
              {allMachines.length}
            </span>
          </button>

          {accounts.map((acc) => {
            const count = allMachines.filter((m) => m.accountId === acc.id).length;
            const active = selectedAccount === acc.id;
            const dotClass =
              acc.lastSyncStatus === 'ok' && acc.enabled
                ? 'bg-emerald-500'
                : acc.lastSyncStatus === 'key_error' || acc.lastSyncStatus === 'rate_limited'
                  ? 'bg-amber-500'
                  : !acc.enabled || acc.lastSyncStatus === 'auto_disabled' || acc.lastSyncStatus === 'auth_error'
                    ? 'bg-rose-500'
                    : 'bg-sky-500';
            return (
              <button
                key={acc.id}
                type="button"
                onClick={() => updateParam('account', active ? '' : acc.id)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  active
                    ? 'border-sky-500 bg-sky-500/15 text-sky-600 dark:text-sky-300'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${dotClass}`} />
                <span>{acc.name}</span>
                <span className="rounded bg-slate-200/80 px-1.5 py-0.2 font-mono text-[10px] dark:bg-slate-800">
                  {count}
                </span>
                {acc.lastSyncStatus === 'auto_disabled' && (
                  <span className="rounded bg-rose-500/15 px-1.5 py-0.2 text-[10px] text-rose-600 dark:text-rose-400">
                    401 Off
                  </span>
                )}
                {acc.lastSyncStatus === 'key_error' && (
                  <span className="rounded bg-amber-500/15 px-1.5 py-0.2 text-[10px] text-amber-600 dark:text-amber-400">
                    Key Err
                  </span>
                )}
                {acc.readOnly && (
                  <span className="rounded bg-slate-200/80 px-1.5 py-0.2 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    RO
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Filter & Bulk Wake All Toolbar */}
      <div className="flex flex-col gap-2.5 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900/70 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => updateParam('q', e.target.value)}
              placeholder="Search name, ID, template, or label=value..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-9 pr-3 text-xs outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          {orgOptions.length > 1 && (
            <select
              value={selectedOrg}
              onChange={(e) => updateParam('org', e.target.value)}
              className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950"
            >
              <option value="">All Orgs</option>
              {orgOptions.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          )}

          <select
            value={selectedState}
            onChange={(e) => updateParam('state', e.target.value)}
            className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950"
          >
            <option value="">All States</option>
            <option value="running">Running</option>
            <option value="suspended">Suspended</option>
            <option value="stopped">Stopped</option>
            <option value="transitioning">Transitioning</option>
            <option value="error">Error</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={wakeCandidates.writable.length === 0}
            onClick={() => {
              setWakeResult(null);
              setWakeModalOpen(true);
            }}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40 md:flex-none"
            title={
              wakeCandidates.writable.length > 0
                ? `Start ${wakeCandidates.stoppedCount} stopped & resume ${wakeCandidates.suspendedCount} suspended VMs (${wakeScopeLabel})`
                : 'No stopped or suspended writable VMs in current filter'
            }
          >
            <Zap className="h-3.5 w-3.5" />
            Wake All ({wakeCandidates.writable.length})
          </button>

          <button
            type="button"
            onClick={handleSyncAll}
            disabled={syncing}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
            Sync
          </button>
        </div>
      </div>

      {/* Empty States */}
      {!loading && accounts.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center dark:border-slate-700 dark:bg-slate-900/50">
          <Server className="mx-auto h-10 w-10 text-slate-400" />
          <h2 className="mt-3 text-base font-semibold">No InstaBox Accounts Connected</h2>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-500 dark:text-slate-400">
            Add one or more InstaBox API keys (single or bulk import) to start monitoring your multi-account VM fleet.
          </p>
          <Link
            to="/accounts?add=1"
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-500"
          >
            <Plus className="h-4 w-4" />
            Add Account
          </Link>
        </div>
      )}

      {!loading && accounts.length > 0 && filteredMachines.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
          No sandboxes match the current filters.
        </div>
      )}

      {/* MOBILE VIEW (< 768px): Card Layout with Touch-Friendly Lifecycle Controls */}
      {filteredMachines.length > 0 && (
        <div className="space-y-3 md:hidden">
          {filteredMachines.map((vm) => {
            const opKey = `${vm.accountId}:${vm.id}`;
            const diskSize = vm.storage?.sizeGiB ?? vm.spec.persistentDiskGiB ?? 0;
            return (
              <div
                key={opKey}
                onClick={() => navigate(`/accounts/${vm.accountId}/vms/${vm.id}`)}
                className="cursor-pointer rounded-xl border border-slate-200 bg-white p-4 shadow-xs transition-colors active:bg-slate-50 dark:border-slate-800 dark:bg-slate-900/80 dark:active:bg-slate-900"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <h3 className="truncate text-sm font-semibold">{vm.name}</h3>
                      <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                    </div>
                    <div className="truncate font-mono text-[11px] text-slate-500 dark:text-slate-400">{vm.id}</div>
                  </div>
                  <VMStateBadge state={vm.state} />
                </div>

                <VMWarningBadges vm={vm} liveMetrics={vm.liveMetrics} />

                <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    {vm.accountName}
                  </span>
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {vm.spec.vcpus}c / {formatMemMiB(vm.spec.memMiB)}
                    {diskSize > 0 ? ` / ${diskSize}G` : ''}
                  </span>
                  {vm.spec.gpus ? (
                    <span className="rounded-md bg-violet-500/15 px-2 py-0.5 font-mono text-violet-600 dark:text-violet-300">
                      {vm.spec.gpus}x {vm.spec.gpuType || 'GPU'}
                    </span>
                  ) : null}
                  {vm.portsCount > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-sky-500/10 px-2 py-0.5 font-mono text-sky-600 dark:text-sky-400">
                      <Globe className="h-3 w-3" />
                      {vm.portsCount}
                    </span>
                  )}
                </div>

                {vm.state === 'running' && vm.liveMetrics ? (
                  <div className="mt-3 space-y-1.5 rounded-lg bg-slate-50 p-2.5 dark:bg-slate-950/70">
                    <MetricBar label="CPU" pct={vm.liveMetrics.cpuUsedPct} color="sky" />
                    <MetricBar label="RAM" pct={vm.liveMetrics.memUsedPct} color="emerald" />
                    {vm.liveMetrics.diskUsedPct !== undefined && (
                      <MetricBar label="DSK" pct={vm.liveMetrics.diskUsedPct} color="violet" />
                    )}
                  </div>
                ) : (
                  <div className="mt-2.5 text-[11px] text-slate-500 dark:text-slate-400">
                    {vm.state === 'running'
                      ? `Uptime: ${formatUptime(vm.runStartedAt)}`
                      : vm.state === 'suspended'
                        ? `Suspended ${formatRelativeTime(vm.autoSuspendedAt || vm.updatedAt)}`
                        : `Updated ${formatRelativeTime(vm.updatedAt || vm.createdAt)}`}
                  </div>
                )}

                <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
                  <LifecycleControls
                    accountId={vm.accountId}
                    machineId={vm.id}
                    machineName={vm.name}
                    state={vm.state}
                    canWrite={vm.canWrite}
                    activeOperation={activeOps[opKey]}
                    mobileFullWidth
                    onOperationStarted={(op) => onOperationStarted(vm.accountId, vm.id, op)}
                    onError={(msg) => setToast({ kind: 'err', text: msg })}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* DESKTOP / TABLET VIEW (>= 768px): Sortable Table */}
      {filteredMachines.length > 0 && (
        <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/70 md:block">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                  <th className="px-4 py-3">
                    <button type="button" onClick={() => toggleSort('name')} className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100">
                      Sandbox / Account
                      <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="px-4 py-3">
                    <button type="button" onClick={() => toggleSort('state')} className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100">
                      State &amp; Health
                      <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="px-4 py-3">Spec &amp; Uptime</th>
                  <th className="px-4 py-3">
                    <div className="inline-flex items-center gap-2">
                      <span>Live Telemetry</span>
                      <button type="button" onClick={() => toggleSort('cpu')} className="hover:text-sky-500">
                        CPU
                      </button>
                      <button type="button" onClick={() => toggleSort('ram')} className="hover:text-emerald-500">
                        RAM
                      </button>
                      <button type="button" onClick={() => toggleSort('disk')} className="hover:text-violet-500">
                        DSK
                      </button>
                    </div>
                  </th>
                  <th className="px-4 py-3 text-right">Lifecycle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {filteredMachines.map((vm) => {
                  const opKey = `${vm.accountId}:${vm.id}`;
                  const diskSize = vm.storage?.sizeGiB ?? vm.spec.persistentDiskGiB ?? 0;
                  return (
                    <tr
                      key={opKey}
                      onClick={() => navigate(`/accounts/${vm.accountId}/vms/${vm.id}`)}
                      className="cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40"
                    >
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">{vm.name}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                          <span>{vm.id}</span>
                          <span>·</span>
                          <span className="font-sans text-slate-600 dark:text-slate-300">{vm.accountName}</span>
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <VMStateBadge state={vm.state} />
                          {vm.snapshotStale && (
                            <span
                              className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400"
                              title={`Cached snapshot from ${formatRelativeTime(vm.snapshotAt)}`}
                            >
                              stale
                            </span>
                          )}
                        </div>
                        <VMWarningBadges vm={vm} liveMetrics={vm.liveMetrics} />
                      </td>

                      <td className="px-4 py-3 font-mono">
                        <div className="text-slate-800 dark:text-slate-200">
                          {vm.spec.vcpus}c / {formatMemMiB(vm.spec.memMiB)}
                          {diskSize > 0 ? ` / ${diskSize}G` : ''}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                          {vm.state === 'running' ? (
                            <span>Up {formatUptime(vm.runStartedAt)}</span>
                          ) : (
                            <span>{formatRelativeTime(vm.updatedAt || vm.createdAt)}</span>
                          )}
                          {vm.spec.gpus ? (
                            <span className="rounded bg-violet-500/15 px-1.5 text-violet-600 dark:text-violet-300">
                              {vm.spec.gpus}x {vm.spec.gpuType || 'GPU'}
                            </span>
                          ) : null}
                          {vm.portsCount > 0 && (
                            <span className="inline-flex items-center gap-0.5 text-sky-600 dark:text-sky-400">
                              <Globe className="h-3 w-3" />
                              {vm.portsCount}
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="w-52 px-4 py-3">
                        {vm.state === 'running' && vm.liveMetrics ? (
                          <div className="space-y-1">
                            <MetricBar label="CPU" pct={vm.liveMetrics.cpuUsedPct} color="sky" />
                            <MetricBar label="RAM" pct={vm.liveMetrics.memUsedPct} color="emerald" />
                            {vm.liveMetrics.diskUsedPct !== undefined && (
                              <MetricBar label="DSK" pct={vm.liveMetrics.diskUsedPct} color="violet" />
                            )}
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400">
                            {vm.state === 'running' ? 'Awaiting metrics...' : 'Idle'}
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-3 text-right">
                        <LifecycleControls
                          accountId={vm.accountId}
                          machineId={vm.id}
                          machineName={vm.name}
                          state={vm.state}
                          canWrite={vm.canWrite}
                          activeOperation={activeOps[opKey]}
                          onOperationStarted={(op) => onOperationStarted(vm.accountId, vm.id, op)}
                          onError={(msg) => setToast({ kind: 'err', text: msg })}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Wake All Confirmation & Result Modal */}
      {wakeModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
          onClick={() => !wakingAll && setWakeModalOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-500">
                <Zap className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold">Wake All Sandboxes ({wakeScopeLabel})</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Follows your active Fleet filters; running VMs and read-only accounts are skipped.
                </p>
              </div>
            </div>

            {!wakeResult ? (
              <>
                <div className="mt-4 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-950">
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Stopped VMs (will Start)</span>
                    <span className="font-mono font-semibold">{wakeCandidates.stoppedCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Suspended VMs (will Resume)</span>
                    <span className="font-mono font-semibold">{wakeCandidates.suspendedCount}</span>
                  </div>
                  {wakeCandidates.readOnlySkipped.length > 0 && (
                    <div className="flex justify-between text-amber-600 dark:text-amber-400">
                      <span>Skipped (read-only / disabled accounts)</span>
                      <span className="font-mono font-semibold">{wakeCandidates.readOnlySkipped.length}</span>
                    </div>
                  )}
                </div>

                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    disabled={wakingAll}
                    onClick={() => setWakeModalOpen(false)}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium dark:border-slate-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={wakingAll || wakeCandidates.writable.length === 0}
                    onClick={handleConfirmWakeAll}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {wakingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                    Wake {wakeCandidates.writable.length} VM{wakeCandidates.writable.length === 1 ? '' : 's'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center font-mono text-xs">
                  <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-600 dark:text-emerald-400">
                    <div className="text-lg font-bold">{wakeResult.triggered}</div>
                    <div>Triggered</div>
                  </div>
                  <div className="rounded-lg bg-slate-500/10 p-2 text-slate-600 dark:text-slate-300">
                    <div className="text-lg font-bold">{wakeResult.skipped}</div>
                    <div>Skipped</div>
                  </div>
                  <div className="rounded-lg bg-rose-500/10 p-2 text-rose-600 dark:text-rose-400">
                    <div className="text-lg font-bold">{wakeResult.failed}</div>
                    <div>Failed</div>
                  </div>
                </div>

                <div className="mt-3 max-h-56 space-y-1.5 overflow-y-auto text-xs">
                  {wakeResult.results.map((r) => (
                    <div
                      key={`${r.accountId}:${r.machineId}`}
                      className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-1.5 dark:border-slate-800"
                    >
                      <div className="min-w-0">
                        <span className="font-semibold">{r.machineName}</span>
                        <span className="ml-2 text-[11px] text-slate-500">{r.accountName}</span>
                        {r.error && <div className="truncate text-[11px] text-rose-500">{r.error}</div>}
                      </div>
                      <span
                        className={`ml-2 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          r.status === 'triggered'
                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                            : r.status === 'skipped'
                              ? 'bg-slate-500/15 text-slate-500'
                              : 'bg-rose-500/15 text-rose-500'
                        }`}
                      >
                        {r.status} ({r.action})
                      </span>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setWakeModalOpen(false)}
                    className="rounded-lg bg-sky-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-sky-500"
                  >
                    Done
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
