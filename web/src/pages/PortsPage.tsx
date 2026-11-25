import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  Globe,
  KeyRound,
  Layers,
  List,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  type PortModalTarget,
  PublishPortModal,
  RotateTokenModal,
  TokenRevealModal,
  UnpublishPortModal,
} from '../components/PublishPortModal';
import { VMStateBadge } from '../components/StateBadge';
import { api, ApiError } from '../lib/api';
import type { FleetResponse, PublicPort } from '../types/instabox';

type ViewMode = 'list' | 'grouped';

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
  onFleetRefresh,
}: {
  fleet?: FleetResponse | null;
  onFleetRefresh?: () => Promise<void> | void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [ports, setPorts] = useState<PublicPort[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

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
    setSearchParams(next, { replace: true });
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

  const copyText = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1500);
    } catch {
      // Clipboard may fail in non-HTTPS contexts
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

  const groupedPorts = useMemo<PortGroup[]>(() => {
    const vmQuotaMap = new Map<string, { state: string; canWrite: boolean; orgName: string }>();
    for (const m of fleet?.machines ?? []) {
      vmQuotaMap.set(`${m.accountId}:${m.id}`, {
        state: m.state,
        canWrite: m.canWrite,
        orgName: m.orgName,
      });
    }

    const groups = new Map<string, PortGroup>();
    for (const p of filteredPorts) {
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
    return Array.from(groups.values());
  }, [filteredPorts, fleet?.machines]);

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

  const renderEndpointCell = (p: PublicPort) => {
    const endpoint = p.address || p.url;
    const isOffline = p.machineState && p.machineState !== 'running';
    return (
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {p.url ? (
            <a
              href={p.url}
              target="_blank"
              rel="noopener noreferrer"
              className="max-w-[260px] truncate font-mono text-xs text-sky-600 hover:underline dark:text-sky-400"
              title={p.url}
            >
              {p.url}
            </a>
          ) : (
            <span className="font-mono text-xs text-slate-700 dark:text-slate-300">{endpoint}</span>
          )}
          <button
            type="button"
            onClick={() => void copyText(`ep-${p.accountId}-${p.id}-${p.port}`, endpoint)}
            className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            title={p.address ? 'Copy SNI address' : 'Copy URL'}
          >
            {copiedId === `ep-${p.accountId}-${p.id}-${p.port}` ? (
              <Check className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
          {p.url && (
            <a
              href={p.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              title="Open URL"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          {p.address && (
            <span className="rounded bg-indigo-500/10 px-1.5 py-0.5 font-mono text-indigo-600 dark:text-indigo-400">
              SNI: {p.address}
            </span>
          )}
          {isOffline && (
            <span
              className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400"
              title="Endpoint returns HTTP 503 while sandbox is stopped or suspended"
            >
              <AlertTriangle className="h-3 w-3" />
              VM {p.machineState} (503)
            </span>
          )}
          {p.access === 'private' && (
            <span className="text-slate-400">Token hidden (rotate to reissue)</span>
          )}
        </div>
      </div>
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
      {!loading && filteredPorts.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900/70">
          <Globe className="mx-auto h-8 w-8 text-slate-400" />
          <div className="mt-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
            {ports.length === 0 ? 'No exposed ports yet' : 'No exposed ports match your filters'}
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {ports.length === 0
              ? 'Expose HTTP apps or TCP services from any sandbox without using CLI commands.'
              : 'Try broadening your search query or resetting active filter chips.'}
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
                        {p.name && <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">{p.name}</span>}
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
                          {p.access === 'private' ? <Lock className="h-2.5 w-2.5" /> : <Globe className="h-2.5 w-2.5" />}
                          {p.access}
                        </span>
                      </div>
                      {renderEndpointCell(p)}
                    </div>
                    <div className="shrink-0">{renderPortActions(p)}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Flat List View: Mobile Cards + Desktop Table */
        <>
          <div className="space-y-3 md:hidden">
            {filteredPorts.map((p) => (
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

                {renderEndpointCell(p)}
                {renderPortActions(p, true)}
              </div>
            ))}
          </div>

          <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/70 md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-950/60">
                  <tr>
                    <th className="px-4 py-2.5">Account / Org</th>
                    <th className="px-4 py-2.5">VM &amp; State</th>
                    <th className="px-4 py-2.5">Port &amp; Name</th>
                    <th className="px-4 py-2.5">Proto / Access</th>
                    <th className="px-4 py-2.5">Endpoint</th>
                    <th className="px-4 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {filteredPorts.map((p) => (
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
                      <td className="px-4 py-3">{renderEndpointCell(p)}</td>
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
        defaultAccountId={accountFilter !== 'all' ? accountFilter : undefined}
        defaultMachineId={vmFilter !== 'all' ? vmFilter : undefined}
        onPublished={() => void refreshAll()}
      />

      <RotateTokenModal
        target={rotateTarget}
        onClose={() => setRotateTarget(null)}
        onRotated={(updated) => {
          const machineName = rotateTarget?.machineName;
          setRotateTarget(null);
          setRevealedPort({ port: updated, machineName });
          void refreshAll();
        }}
      />

      <UnpublishPortModal
        target={unpublishTarget}
        onClose={() => setUnpublishTarget(null)}
        onUnpublished={() => {
          setUnpublishTarget(null);
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
