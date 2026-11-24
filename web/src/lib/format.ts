export function formatBytes(bytes: number | undefined | null): string {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return '—';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = Math.min(Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val >= 100 || i === 0 ? val.toFixed(0) : val.toFixed(1)} ${units[i]}`;
}

export function formatBytesPerSec(bps: number | undefined | null): string {
  if (bps === undefined || bps === null || Number.isNaN(bps)) return '0 B/s';
  return `${formatBytes(bps)}/s`;
}

export function formatMemMiB(mib: number): string {
  if (mib >= 1024) {
    const gib = mib / 1024;
    return `${Number.isInteger(gib) ? gib : gib.toFixed(1)} GiB`;
  }
  return `${mib} MiB`;
}

export function formatDurationSeconds(sec: number): string {
  if (!sec || sec < 0) return '0s';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatRelativeTime(iso?: string | null): string {
  if (!iso) return '—';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '—';
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

export function formatUptime(runStartedAt?: string | null): string {
  if (!runStartedAt) return '—';
  const ts = Date.parse(runStartedAt);
  if (Number.isNaN(ts)) return '—';
  return formatDurationSeconds(Math.max(0, Math.floor((Date.now() - ts) / 1000)));
}

export function formatShortClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
