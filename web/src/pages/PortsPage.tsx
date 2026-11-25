import {
  ArrowUpDown,
  CheckCircle2,
  Globe,
  KeyRound,
  Layers,
  List,
  Loader2,
  Lock,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PortEndpoint } from '../components/PortEndpoint';
import {
  type PortModalTarget,
  PublishPortModal,
  RotateTokenModal,
  TokenRevealModal,
  UnpublishPortModal,
} from '../components/PublishPortModal';
import { VMStateBadge } from '../components/StateBadge';
import { api, ApiError } from '../lib/api';
import { formatRelativeTime } from '../lib/format';
import type { FleetResponse, Operation, PublicPort } from '../types/instabox';

type ViewMode = 'list' | 'grouped';
type SortField = 'account' | 'vm' | 'port' | 'protocol' | 'access' | 'created';

interface PortGroup {
  key: string;
  accountId: string;
  accountName: string;
  orgName?: string;
  machineId: string;
  machineName: string;
  machineState: string;
  canWrite: boolean;
  ports: PublicPort[];
}

export function PortsPage({
  fleet,
  activeOps = {},
  onOperationStarted,
  onFleetRefresh,
}: {
  fleet?: FleetResponse | null;
  activeOps?: Record<string, Operation>;
  onOperationStarted?: (accountId: string, machineId: string, op: Operation) => void;
  onFleetRefresh?: () => Promise<void> | void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [ports, setPorts] = useState<PublicPort[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const [wakingKey, setWakingKey] = useState<string | null>(null);

  const [sortField, setSortField] = useState<SortField>('account');
  const [sortAsc, setSortAsc] = useState(true);

  // Modal states
  const [publishOpen, setPublishOpen] = useState(false);
  const [editingPort, setEditingPort] = useState<PublicPort | null>(null);
  const [fixedTarget, setFixedTarget] = useState<PortModalTarget | undefined>(undefined);
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
  const [revealedPort, setRevealedPort] = useState<{ port: PublicPort; machineName?: string } | null>(null);

  const accountFilter = searchParams.get('account') || 'all';
  const vmFilter = searchParams.get('vm') || 'all';
  const accessFilter = searchParams.get('access') || 'all';
  const protocolFilter = searchParams.get('protocol') || 'all';
  const searchQuery = searchParams.get('q') || '';
  const viewMode: ViewMode = searchParams.get('view') === 'grouped' ? 'grouped' : 'list';
  const showEmptyVMs = searchParams.get('empty') === '1';

  const showToast = useCallback((kind: 'ok' | 'err', text: string) => {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    setToast({ kind, text });
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 4500);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  const updateParam = useCallback(
    (key: string, value: string, defaultValue = 'all') => {
      const next = new URLSearchParams(searchParams);
      if (!value || value === defaultValue) {
        next.delete(key);
      } else {
        next.set(key, value);
      }
      if (key === 'account') {
        next.delete('vm');
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const clearFilters = () => {
    const next = new URLSearchParams();
    if (viewMode === 'grouped') next.set('view', 'grouped');
    if (viewMode === 'grouped' && showEmptyVMs) next.set('empty', '1');
    setSearchParams(next, { replace: true });
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc((prev) => !prev);
    } else {
      setSortField(field);
      setSortAsc(field !== 'created');
    }
  };

  const loadPorts = useCallback(async () => {
    try {
      const res = await api.getPorts();
      setPorts(res.ports);
      setError('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load exposed ports');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPorts();
  }, [loadPorts, fleet?.generatedAt]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadPorts(), Promise.resolve(onFleetRefresh?.())]);
  }, [loadPorts, onFleetRefresh]);

  const handleQuickWake = async (
    accountId: string,
    machineId: string,
    machineName: string,
    machineState: string,
  ) => {
    const key = `${accountId}:${machineId}`;
    const action = machineState === 'suspended' ? 'resume' : 'start';
    setWakingKey(key);
    try {
      const op = await api.vmAction(accountId, machineId, action, { machineName });
      onOperationStarted?.(accountId, machineId, op);
      showToast('ok', `Requested ${action === 'resume' ? 'wake' : 'start'} on ${machineName || machineId}.`);
    } catch (err) {
      showToast('err', err instanceof ApiError ? err.message : `Failed to ${action} ${machineName || machineId}`);
    } finally {
      setWakingKey((prev) => (prev === key ? null : prev));
    }
  };

  const accountSummary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of ports) {
      const key = p.accountId || '';
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    if (fleet?.accounts && fleet.accounts.length > 0) {
      return fleet.accounts.map((a) => ({
        id: a.id,
        name: a.name,
        canWrite: a.canWrite,
        count: counts.get(a.id) || 0,
      }));
    }

    const seen = new Map<string, { id: string; name: string; canWrite: boolean; count: number }>();
    for (const p of ports) {
      const id = p.accountId || '';
      if (!seen.has(id)) {
        seen.set(id, {
          id,
          name: p.accountName || id,
          canWrite: p.canWrite ?? true,
          count: counts.get(id) || 0,
        });
      }
    }
    return Array.from(seen.values());
  }, [fleet?.accounts, ports]);

  const vmOptions = useMemo(() => {
    if (fleet?.machines && fleet.machines.length > 0) {
      return fleet.machines
        .filter((m) => accountFilter === 'all' || m.accountId === accountFilter)
        .map((m) => ({
          id: m.id,
          name: m.name,
          accountId: m.accountId,
          accountName: m.accountName,
        }));
    }
    const seen = new Map<string, { id: string; name: string; accountId: string; accountName: string }>();
    for (const p of ports) {
      if (accountFilter !== 'all' && p.accountId !== accountFilter) continue;
      if (!seen.has(p.machineId)) {
        seen.set(p.machineId, {
          id: p.machineId,
          name: p.machineName || p.machineId,
          accountId: p.accountId || '',
          accountName: p.accountName || '',
        });
      }
    }
    return Array.from(seen.values());
  }, [fleet?.machines, ports, accountFilter]);

  const filteredPorts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return ports.filter((p) => {
      if (accountFilter !== 'all' && p.accountId !== accountFilter) return false;
      if (vmFilter !== 'all' && p.machineId !== vmFilter) return false;
      if (accessFilter !== 'all' && p.access !== accessFilter) return false;
      if (protocolFilter !== 'all' && p.protocol.toLowerCase() !== protocolFilter) return false;
      if (q) {
        const haystack = [
          String(p.port),
          p.name,
          p.url,
          p.address,
          p.machineName,
          p.machineId,
          p.accountName,
          p.orgName,
          p.protocol,
          p.access,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [ports, accountFilter, vmFilter, accessFilter, protocolFilter, searchQuery]);

  const sortedPorts = useMemo(() => {
    const dir = sortAsc ? 1 : -1;
    return [...filteredPorts].sort((a, b) => {
      switch (sortField) {
        case 'vm': {
          const cmp = (a.machineName || a.machineId).localeCompare(b.machineName || b.machineId);
          return (cmp !== 0 ? cmp : a.port - b.port) * dir;
        }
        case 'port':
          return (a.port - b.port) * dir;
        case 'protocol': {
          const cmp = a.protocol.localeCompare(b.protocol);
          return (cmp !== 0 ? cmp : a.port - b.port) * dir;
        }
        case 'access': {
          const cmp = a.access.localeCompare(b.access);
          return (cmp !== 0 ? cmp : a.port - b.port) * dir;
        }
        case 'created': {
          const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
          const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
          if (ta !== tb) return (ta - tb) * dir;
          return (a.port - b.port) * dir;
        }
        case 'account':
        default: {
          const accCmp = (a.accountName || a.accountId || '').localeCompare(b.accountName || b.accountId || '');
          if (accCmp !== 0) return accCmp * dir;
          const vmCmp = (a.machineName || a.machineId).localeCompare(b.machineName || b.machineId);
          if (vmCmp !== 0) return vmCmp * dir;
          return (a.port - b.port) * dir;
        }
      }
    });
  }, [filteredPorts, sortField, sortAsc]);

  const groupedPorts = useMemo<PortGroup[]>(() => {
    const vmQuotaMap = new Map<string, { state: string; canWrite: boolean; orgName: string }>();
    for (const m of fleet?.machines ?? []) {
      vmQuotaMap.set(`${m.accountId}:${m.id}`, {
        state: m.state,
        canWrite: m.canWrite,
        orgName: m.orgName,
      });
    }

    const totalPortsByVM = new Set<string>();
    for (const p of ports) {
      totalPortsByVM.add(`${p.accountId || ''}:${p.machineId}`);
    }

    const groups = new Map<string, PortGroup>();
    for (const p of sortedPorts) {
      const accId = p.accountId || '';
      const key = `${accId}:${p.machineId}`;
      const vmInfo = vmQuotaMap.get(key);
      let grp = groups.get(key);
      if (!grp) {
        grp = {
          key,
          accountId: accId,
          accountName: p.accountName || accId,
          orgName: p.orgName || vmInfo?.orgName,
          machineId: p.machineId,
          machineName: p.machineName || p.machineId,
          machineState: p.machineState || vmInfo?.state || 'unknown',
          canWrite: p.canWrite ?? vmInfo?.canWrite ?? true,
          ports: [],
        };
        groups.set(key, grp);
      }
      grp.ports.push(p);
    }

    if (viewMode === 'grouped' && showEmptyVMs && fleet?.machines) {
      const q = searchQuery.trim().toLowerCase();
      for (const m of fleet.machines) {
        const key = `${m.accountId}:${m.id}`;
        if (groups.has(key) || totalPortsByVM.has(key)) continue;
        if (accountFilter !== 'all' && m.accountId !== accountFilter) continue;
        if (vmFilter !== 'all' && m.id !== vmFilter) continue;
        if (q) {
          const hay = [m.name, m.id, m.accountName, m.orgName, m.state].filter(Boolean).join(' ').toLowerCase();
          if (!hay.includes(q)) continue;
        }
        groups.set(key, {
          key,
          accountId: m.accountId,
          accountName: m.accountName,
          orgName: m.orgName,
          machineId: m.id,
          machineName: m.name,
          machineState: m.state,
          canWrite: m.canWrite,
          ports: [],
        });
      }
    }

    return Array.from(groups.values());
  }, [sortedPorts, ports, fleet?.machines, viewMode, showEmptyVMs, accountFilter, vmFilter, searchQuery]);

  const stats = useMemo(() => {
    let publicCount = 0;
    let privateCount = 0;
    let tcpCount = 0;
    let runningCount = 0;
    for (const p of ports) {
      if (p.access === 'private') privateCount++;
      else publicCount++;
      if (p.protocol.toLowerCase() === 'tcp') tcpCount++;
      if (p.machineState === 'running') runningCount++;
    }
    return {
      total: ports.length,
      publicCount,
      privateCount,
      tcpCount,
      httpCount: ports.length - tcpCount,
      runningCount,
      offlineCount: ports.length - runningCount,
    };
  }, [ports]);

  const hasWritableAccounts = useMemo(() => {
    if (!fleet?.accounts || fleet.accounts.length === 0) return ports.some((p) => p.canWrite !== false);
    return fleet.accounts.some((a) => a.enabled && a.canWrite);
  }, [fleet?.accounts, ports]);

  const hasActiveFilters =
    accountFilter !== 'all' ||
    vmFilter !== 'all' ||
    accessFilter !== 'all' ||
    protocolFilter !== 'all' ||
    Boolean(searchQuery.trim());

  const hasVisibleRows = viewMode === 'grouped' ? groupedPorts.length > 0 : sortedPorts.length > 0;

  const openPublishNew = (target?: PortModalTarget) => {
    setEditingPort(null);
    setFixedTarget(target);
    setPublishOpen(true);
  };

  const openEditPort = (port: PublicPort) => {
    setEditingPort(port);
    setFixedTarget({
      accountId: port.accountId || '',
      accountName: port.accountName,
      machineId: port.machineId,
      machineName: port.machineName,
      machineState: port.machineState,
      canWrite: port.canWrite,
    });
    setPublishOpen(true);
  };

  const getPortTarget = (p: PublicPort) => ({
    accountId: p.accountId || '',
    machineId: p.machineId,
    machineName: p.machineName,
    port: p,
  });

  const renderQuickWakeButton = (
    accountId?: string,
    machineId?: string,
    machineName?: string,
    machineState?: string,
    canWrite = true,
  ) => {
    if (!accountId || !machineId) return null;
    if (machineState !== 'stopped' && machineState !== 'suspended') return null;
    const key = `${accountId}:${machineId}`;
    const op = activeOps[key];
    const isBusy = wakingKey === key || op?.state === 'queued' || op?.state === 'running';
    const isSuspended = machineState === 'suspended';

    return (
      <button
        type="button"
        disabled={!canWrite || isBusy}
        title={
          !canWrite
            ? 'Account is read-only or lacks machines:write scope'
            : isSuspended
              ? 'Wake suspended sandbox'
              : 'Start stopped sandbox'
        }
        onClick={() => void handleQuickWake(accountId, machineId, machineName || machineId, machineState)}
        className="inline-flex items-center gap-1 rounded-md border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-45 dark:text-emerald-300"
      >
        {isBusy ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : isSuspended ? (
          <Zap className="h-3 w-3" />
        ) : (
          <Play className="h-3 w-3" />
        )}
        {isBusy ? op?.phase || 'Waking...' : isSuspended ? 'Wake VM' : 'Start VM'}
      </button>
    );
  };

  const renderPortActions = (p: PublicPort, compact = false) => {
    const canWrite = p.canWrite !== false;
    const disabledTitle = canWrite ? undefined : 'Account is read-only or lacks machines:write scope';
    const btnCls = compact
      ? 'inline-flex flex-1 min-h-[36px] items-center justify-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45'
      : 'inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45';

    return (
      <div className={`flex items-center gap-1.5 ${compact ? 'w-full' : 'justify-end'}`}>
        <button
          type="button"
          disabled={!canWrite}
          title={disabledTitle || 'Edit name or access'}
          onClick={() => openEditPort(p)}
          className={`${btnCls} border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800`}
        >
          <Pencil className="h-3 w-3" />
          Edit
        </button>

        {p.access === 'private' && (
          <button
            type="button"
            disabled={!canWrite}
            title={disabledTitle || 'Rotate private access token'}
            onClick={() => setRotateTarget(getPortTarget(p))}
            className={`${btnCls} border-amber-500/30 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300`}
          >
            <KeyRound className="h-3 w-3" />
            Rotate
          </button>
        )}

        <button
          type="button"
          disabled={!canWrite}
          title={disabledTitle || 'Unpublish port'}
          onClick={() => setUnpublishTarget(getPortTarget(p))}
          className={`${btnCls} border-rose-500/30 bg-rose-500/10 text-rose-600 hover:bg-rose-500/20 dark:text-rose-400`}
        >
          <Trash2 className="h-3 w-3" />
          Unpublish
        </button>
      </div>
    );
  };

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
          <div className="flex items-center gap-2">
            {toast.kind === 'ok' && <CheckCircle2 className="h-4 w-4 shrink-0" />}
            <span>{toast.text}</span>
          </div>
          <button type="button" onClick={() => setToast(null)} className="ml-4 font-semibold underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Exposed Ports</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Publish, protect, rotate access tokens, and inspect live HTTP &amp; TCP endpoints across all accounts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refreshAll()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            type="button"
            disabled={(fleet?.machines?.length ?? 0) === 0}
            title={
              (fleet?.machines?.length ?? 0) === 0
                ? 'Add an account with at least one sandbox first'
                : !hasWritableAccounts
                  ? 'No writable accounts enabled (modal will show read-only status)'
                  : 'Publish a new sandbox port'
            }
            onClick={() => openPublishNew()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Publish Port
          </button>
        </div>
      </div>

      {/* 4 KPI Summary Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900/70">
          <div className="flex items-center justify-between text-[11px] font-medium text-slate-500 dark:text-slate-400">
            <span>Total Published</span>
            <Server className="h-3.5 w-3.5 text-sky-500" />
          </div>
          <div className="mt-1 font-mono text-2xl font-bold tabular-nums">{stats.total}</div>
          <div className="mt-0.5 text-[11px] text-slate-500">
            {stats.httpCount} HTTP · {stats.tcpCount} TCP
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900/70">
          <div className="flex items-center justify-between text-[11px] font-medium text-slate-500 dark:text-slate-400">
            <span>Public Ingress</span>
            <Globe className="h-3.5 w-3.5 text-emerald-500" />
          </div>
          <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
            {stats.publicCount}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500">Direct access without token</div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900/70">
          <div className="flex items-center justify-between text-[11px] font-medium text-slate-500 dark:text-slate-400">
            <span>Private (Token)</span>
            <Lock className="h-3.5 w-3.5 text-amber-500" />
          </div>
          <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
            {stats.privateCount}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500">Protected by one-time secret</div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900/70">
          <div className="flex items-center justify-between text-[11px] font-medium text-slate-500 dark:text-slate-400">
            <span>Live Reachable</span>
            <ShieldCheck className="h-3.5 w-3.5 text-indigo-500" />
          </div>
          <div className="mt-1 font-mono text-2xl font-bold tabular-nums">{stats.runningCount}</div>
          <div className="mt-0.5 text-[11px] text-slate-500">
            {stats.offlineCount > 0 ? `${stats.offlineCount} on offline VM (503)` : 'All mapped to running VMs'}
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-500">{error}</div>
      )}

      {/* Account Quick-Filter Chips */}
      {accountSummary.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => updateParam('account', 'all')}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              accountFilter === 'all'
                ? 'border-sky-500/40 bg-sky-500/15 text-sky-600 dark:text-sky-400'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800'
            }`}
          >
            All Accounts
            <span className="font-mono text-[11px] opacity-80">{ports.length}</span>
          </button>
          {accountSummary.map((acc) => (
            <button
              key={acc.id}
              type="button"
              onClick={() => updateParam('account', accountFilter === acc.id ? 'all' : acc.id)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                accountFilter === acc.id
                  ? 'border-sky-500/40 bg-sky-500/15 text-sky-600 dark:text-sky-400'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800'
              }`}
            >
              <span>{acc.name}</span>
              {!acc.canWrite && <span className="text-[10px] text-amber-500">(RO)</span>}
              <span className="font-mono text-[11px] opacity-80">{acc.count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Filter & View Toggle Bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900/70">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => updateParam('q', e.target.value, '')}
            placeholder="Search port, name, URL, SNI address, VM..."
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-3 text-xs text-slate-900 outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
        </div>

        <select
          value={vmFilter}
          onChange={(e) => updateParam('vm', e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
        >
          <option value="all">All Sandboxes</option>
          {vmOptions.map((vm) => (
            <option key={vm.id} value={vm.id}>
              {vm.name} {accountFilter === 'all' && vm.accountName ? `(${vm.accountName})` : ''}
            </option>
          ))}
        </select>

        <select
          value={accessFilter}
          onChange={(e) => updateParam('access', e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
        >
          <option value="all">All Access</option>
          <option value="public">Public</option>
          <option value="private">Private</option>
        </select>

        <select
          value={protocolFilter}
          onChange={(e) => updateParam('protocol', e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
        >
          <option value="all">All Protocols</option>
          <option value="http">HTTP</option>
          <option value="tcp">TCP (SNI)</option>
        </select>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <X className="h-3.5 w-3.5" />
            Clear
          </button>
        )}

        {viewMode === 'grouped' && (
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
            <input
              type="checkbox"
              checked={showEmptyVMs}
              onChange={(e) => updateParam('empty', e.target.checked ? '1' : '', '')}
              className="rounded border-slate-400 text-sky-600 focus:ring-sky-500"
            />
            <span>Show VMs with 0 ports</span>
          </label>
        )}

        <div className="ml-auto flex items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-slate-800 dark:bg-slate-950">
          <button
            type="button"
            onClick={() => updateParam('view', 'list', 'list')}
            className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              viewMode === 'list'
                ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
            }`}
          >
            <List className="h-3.5 w-3.5" />
            List
          </button>
          <button
            type="button"
            onClick={() => updateParam('view', 'grouped', 'list')}
            className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              viewMode === 'grouped'
                ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            Grouped by VM
          </button>
        </div>
      </div>

      {/* Empty States */}
      {!loading && !hasVisibleRows ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900/70">
          <Globe className="mx-auto h-8 w-8 text-slate-400" />
          <div className="mt-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
            {ports.length === 0 ? 'No exposed ports yet' : 'No exposed ports match your filters'}
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {ports.length === 0
              ? 'Expose HTTP apps or TCP services from any sandbox without using CLI commands.'
              : 'Try broadening your search query, toggling "Show VMs with 0 ports" in Grouped view, or resetting filters.'}
          </p>
          <div className="mt-4 flex justify-center gap-2">
            {ports.length > 0 && hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Reset Filters
              </button>
            )}
            {(fleet?.machines?.length ?? 0) > 0 && (
              <button
                type="button"
                onClick={() => openPublishNew()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-sky-500"
              >
                <Plus className="h-3.5 w-3.5" />
                Publish Port
              </button>
            )}
          </div>
        </div>
      ) : viewMode === 'grouped' ? (
        /* Grouped by VM View */
        <div className="space-y-4">
          {groupedPorts.map((group) => (
            <div
              key={group.key}
              className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/70"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/60">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to={`/accounts/${group.accountId}/vms/${group.machineId}`}
                    className="font-mono text-sm font-semibold text-sky-600 hover:underline dark:text-sky-400"
                  >
                    {group.machineName}
                  </Link>
                  <VMStateBadge state={group.machineState} />
                  {renderQuickWakeButton(
                    group.accountId,
                    group.machineId,
                    group.machineName,
                    group.machineState,
                    group.canWrite,
                  )}
                  <span className="rounded bg-slate-200/70 px-2 py-0.5 text-[11px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    {group.accountName}
                    {group.orgName ? ` · ${group.orgName}` : ''}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-slate-500">{group.ports.length} / 16 ports</span>
                  <button
                    type="button"
                    disabled={!group.canWrite || group.ports.length >= 16}
                    onClick={() =>
                      openPublishNew({
                        accountId: group.accountId,
                        accountName: group.accountName,
                        machineId: group.machineId,
                        machineName: group.machineName,
                        machineState: group.machineState,
                        portsCount: group.ports.length,
                        canWrite: group.canWrite,
                      })
                    }
                    className="inline-flex items-center gap-1 rounded-lg border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-xs font-semibold text-sky-600 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-45 dark:text-sky-400"
                  >
                    <Plus className="h-3 w-3" />
                    Publish to VM
                  </button>
                </div>
              </div>

              {group.ports.length === 0 ? (
                <div className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                  No ports published yet on this sandbox.
                </div>
              ) : (
                <div className="divide-y divide-slate-200 dark:divide-slate-800">
                  {group.ports.map((p) => (
                    <div
                      key={`${group.key}-${p.id}-${p.port}`}
                      className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between"
                    >
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-md bg-sky-500/10 px-2 py-0.5 font-mono text-xs font-bold text-sky-600 dark:text-sky-400">
                            :{p.port}
                          </span>
                          {p.name && (
                            <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">{p.name}</span>
                          )}
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            {p.protocol}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                              p.access === 'private'
                                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                                : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                            }`}
                          >
                            {p.access === 'private' ? (
                              <Lock className="h-2.5 w-2.5" />
                            ) : (
                              <Globe className="h-2.5 w-2.5" />
                            )}
                            {p.access}
                          </span>
                          {p.createdAt && (
                            <span className="text-[11px] text-slate-400" title={p.createdAt}>
                              {formatRelativeTime(p.createdAt)}
                            </span>
                          )}
                        </div>
                        <PortEndpoint
                          port={p}
                          offlineAction={renderQuickWakeButton(
                            p.accountId,
                            p.machineId,
                            p.machineName,
                            p.machineState,
                            p.canWrite !== false,
                          )}
                        />
                      </div>
                      <div className="shrink-0">{renderPortActions(p)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        /* Flat List View: Mobile Cards + Desktop Sortable Table */
        <>
          <div className="space-y-3 md:hidden">
            {sortedPorts.map((p) => (
              <div
                key={`mob-${p.accountId}-${p.machineId}-${p.id}-${p.port}`}
                className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/70"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-md bg-sky-500/10 px-2 py-0.5 font-mono text-xs font-bold text-sky-600 dark:text-sky-400">
                        :{p.port}
                      </span>
                      {p.name && <span className="text-xs font-semibold">{p.name}</span>}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-xs">
                      <Link
                        to={`/accounts/${p.accountId}/vms/${p.machineId}`}
                        className="font-mono font-medium text-sky-600 hover:underline dark:text-sky-400"
                      >
                        {p.machineName || p.machineId}
                      </Link>
                      {p.machineState && <VMStateBadge state={p.machineState} />}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      {p.accountName}
                      {p.orgName ? ` · ${p.orgName}` : ''}
                      {p.createdAt ? ` · ${formatRelativeTime(p.createdAt)}` : ''}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {p.protocol}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                        p.access === 'private'
                          ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                          : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {p.access}
                    </span>
                  </div>
                </div>

                <PortEndpoint
                  port={p}
                  offlineAction={renderQuickWakeButton(
                    p.accountId,
                    p.machineId,
                    p.machineName,
                    p.machineState,
                    p.canWrite !== false,
                  )}
                />
                {renderPortActions(p, true)}
              </div>
            ))}
          </div>

          <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/70 md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-950/60">
                  <tr>
                    <th className="px-4 py-2.5">
                      <button
                        type="button"
                        onClick={() => toggleSort('account')}
                        className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100"
                      >
                        Account / Org
                        <ArrowUpDown className="h-3 w-3" />
                      </button>
                    </th>
                    <th className="px-4 py-2.5">
                      <button
                        type="button"
                        onClick={() => toggleSort('vm')}
                        className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100"
                      >
                        VM &amp; State
                        <ArrowUpDown className="h-3 w-3" />
                      </button>
                    </th>
                    <th className="px-4 py-2.5">
                      <button
                        type="button"
                        onClick={() => toggleSort('port')}
                        className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100"
                      >
                        Port &amp; Name
                        <ArrowUpDown className="h-3 w-3" />
                      </button>
                    </th>
                    <th className="px-4 py-2.5">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => toggleSort('protocol')}
                          className="hover:text-slate-900 dark:hover:text-slate-100"
                        >
                          Proto
                        </button>
                        <span>/</span>
                        <button
                          type="button"
                          onClick={() => toggleSort('access')}
                          className="hover:text-slate-900 dark:hover:text-slate-100"
                        >
                          Access
                        </button>
                      </div>
                    </th>
                    <th className="px-4 py-2.5">
                      <button
                        type="button"
                        onClick={() => toggleSort('created')}
                        className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100"
                      >
                        Created
                        <ArrowUpDown className="h-3 w-3" />
                      </button>
                    </th>
                    <th className="px-4 py-2.5">Endpoint</th>
                    <th className="px-4 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {sortedPorts.map((p) => (
                    <tr
                      key={`${p.accountId}-${p.machineId}-${p.id}-${p.port}`}
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900 dark:text-slate-100">{p.accountName}</div>
                        {p.orgName && <div className="text-[11px] text-slate-500">{p.orgName}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          to={`/accounts/${p.accountId}/vms/${p.machineId}`}
                          className="font-mono font-medium text-sky-600 hover:underline dark:text-sky-400"
                        >
                          {p.machineName || p.machineId}
                        </Link>
                        {p.machineState && (
                          <div className="mt-1">
                            <VMStateBadge state={p.machineState} />
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">:{p.port}</div>
                        {p.name && <div className="text-[11px] text-slate-500">{p.name}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] uppercase dark:bg-slate-800">
                            {p.protocol}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase ${
                              p.access === 'private'
                                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                                : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                            }`}
                          >
                            {p.access === 'private' ? <Lock className="h-3 w-3" /> : <Globe className="h-3 w-3" />}
                            {p.access}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-slate-500" title={p.createdAt || undefined}>
                        {p.createdAt ? formatRelativeTime(p.createdAt) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <PortEndpoint
                          port={p}
                          offlineAction={renderQuickWakeButton(
                            p.accountId,
                            p.machineId,
                            p.machineName,
                            p.machineState,
                            p.canWrite !== false,
                          )}
                        />
                      </td>
                      <td className="px-4 py-3 text-right">{renderPortActions(p)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Modals */}
      <PublishPortModal
        isOpen={publishOpen}
        onClose={() => {
          setPublishOpen(false);
          setEditingPort(null);
          setFixedTarget(undefined);
        }}
        fleet={fleet}
        fixedTarget={fixedTarget}
        editingPort={editingPort}
        existingPorts={ports}
        defaultAccountId={accountFilter !== 'all' ? accountFilter : undefined}
        defaultMachineId={vmFilter !== 'all' ? vmFilter : undefined}
        onSwitchToEdit={(existing) => openEditPort(existing)}
        onPublished={(result) => {
          showToast(
            'ok',
            editingPort
              ? `Updated port :${result.port} (${result.access}).`
              : `Published port :${result.port} (${result.protocol.toUpperCase()}, ${result.access}).`,
          );
          void refreshAll();
        }}
      />

      <RotateTokenModal
        target={rotateTarget}
        onClose={() => setRotateTarget(null)}
        onRotated={(updated) => {
          const machineName = rotateTarget?.machineName;
          setRotateTarget(null);
          setRevealedPort({ port: updated, machineName });
          showToast('ok', `Rotated private token for port :${updated.port}.`);
          void refreshAll();
        }}
      />

      <UnpublishPortModal
        target={unpublishTarget}
        onClose={() => setUnpublishTarget(null)}
        onUnpublished={() => {
          const removedPort = unpublishTarget?.port.port;
          setUnpublishTarget(null);
          showToast('ok', `Unpublished port :${removedPort}.`);
          void refreshAll();
        }}
      />

      <TokenRevealModal
        port={revealedPort?.port ?? null}
        machineName={revealedPort?.machineName}
        onClose={() => setRevealedPort(null)}
      />
    </div>
  );
}
