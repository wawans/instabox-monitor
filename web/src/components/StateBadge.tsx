import { AlertTriangle, Flame, Lock, Pause, Play, ShieldAlert, Square, WifiOff } from 'lucide-react';
import type { Account, FleetMachine, Machine, VMLiveTelemetry } from '../types/instabox';

export function VMStateBadge({ state }: { state: string }) {
  switch (state) {
    case 'running':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
          running
        </span>
      );
    case 'suspended':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
          <Pause className="h-3 w-3" />
          suspended
        </span>
      );
    case 'stopped':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-500/15 px-2.5 py-0.5 text-xs font-semibold text-slate-600 dark:text-slate-400">
          <Square className="h-2.5 w-2.5" />
          stopped
        </span>
      );
    case 'error':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2.5 py-0.5 text-xs font-semibold text-rose-600 dark:text-rose-400">
          <AlertTriangle className="h-3 w-3" />
          error
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/15 px-2.5 py-0.5 text-xs font-semibold text-sky-600 dark:text-sky-400">
          <Play className="h-3 w-3 animate-pulse" />
          {state}
        </span>
      );
  }
}

export function AccountStatusBadge({ account }: { account: Pick<Account, 'enabled' | 'lastSyncStatus'> }) {
  if (account.lastSyncStatus === 'key_error') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
        <ShieldAlert className="h-3 w-3" />
        Key Error
      </span>
    );
  }
  if (account.lastSyncStatus === 'auto_disabled') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2.5 py-0.5 text-xs font-semibold text-rose-600 dark:text-rose-400">
        <ShieldAlert className="h-3 w-3" />
        Auto-Disabled (401)
      </span>
    );
  }
  if (!account.enabled) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-500/15 px-2.5 py-0.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
        Disabled
      </span>
    );
  }
  switch (account.lastSyncStatus) {
    case 'ok':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Healthy
        </span>
      );
    case 'rate_limited':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
          Rate Limited (429)
        </span>
      );
    case 'auth_error':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2.5 py-0.5 text-xs font-semibold text-rose-600 dark:text-rose-400">
          Auth Error (401)
        </span>
      );
    case 'permission_error':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
          Missing Scope (403)
        </span>
      );
    case 'pending':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/15 px-2.5 py-0.5 text-xs font-semibold text-sky-600 dark:text-sky-400">
          Syncing...
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2.5 py-0.5 text-xs font-semibold text-rose-600 dark:text-rose-400">
          Sync Error
        </span>
      );
  }
}

export function VMWarningBadges({
  vm,
  liveMetrics,
}: {
  vm: Machine | FleetMachine;
  liveMetrics?: VMLiveTelemetry;
}) {
  const badges: React.ReactNode[] = [];
  if (vm.oomKills > 0) {
    badges.push(
      <span
        key="oom"
        className="inline-flex items-center gap-1 rounded bg-rose-500/15 px-1.5 py-0.5 text-[11px] font-medium text-rose-600 dark:text-rose-400"
        title={vm.lastOom ? `Last OOM: ${vm.lastOom.process} (PID ${vm.lastOom.pid})` : undefined}
      >
        <Flame className="h-3 w-3" />
        {vm.oomKills} OOM
      </span>,
    );
  }
  if (vm.abuseLock || vm.cooldownReason) {
    badges.push(
      <span
        key="lock"
        className="inline-flex items-center gap-1 rounded bg-rose-500/15 px-1.5 py-0.5 text-[11px] font-medium text-rose-600 dark:text-rose-400"
      >
        <Lock className="h-3 w-3" />
        {vm.abuseLock ? 'Abuse Lock' : vm.cooldownReason}
      </span>,
    );
  }
  if (vm.runtime?.hostUnreachable) {
    badges.push(
      <span
        key="host"
        className="inline-flex items-center gap-1 rounded bg-rose-500/15 px-1.5 py-0.5 text-[11px] font-medium text-rose-600 dark:text-rose-400"
      >
        <WifiOff className="h-3 w-3" />
        Host Unreachable
      </span>,
    );
  }
  const diskLevel = liveMetrics?.diskWarning?.level ?? liveMetrics?.diskLevel;
  if (diskLevel && diskLevel !== 'ok') {
    const isCrit = diskLevel === 'critical' || diskLevel === 'full';
    const pct = liveMetrics?.diskWarning?.usedPct ?? liveMetrics?.diskUsedPct;
    badges.push(
      <span
        key="disk"
        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${
          isCrit
            ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
            : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
        }`}
      >
        <AlertTriangle className="h-3 w-3" />
        Disk {diskLevel}
        {pct !== undefined ? ` (${Math.round(pct)}%)` : ''}
      </span>,
    );
  }

  if (badges.length === 0) return null;
  return <div className="mt-1 flex flex-wrap gap-1">{badges}</div>;
}
