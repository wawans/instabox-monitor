import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatShortClock } from '../lib/format';
import type { MachineMetricSample } from '../types/instabox';

export function MetricCharts({ samples }: { samples: MachineMetricSample[] }) {
  if (!samples || samples.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-400">
        No metric samples recorded in this window (samples are collected every 30s while the sandbox is running).
      </div>
    );
  }

  const data = samples.map((s) => ({
    time: formatShortClock(s.timestamp),
    cpuPct: Number(s.cpuUsedPct.toFixed(1)),
    memGiB: Number((s.memUsed / (1024 * 1024 * 1024)).toFixed(2)),
    memTotalGiB: Number((s.memTotal / (1024 * 1024 * 1024)).toFixed(2)),
    netInKB: Number((s.netInBytesPerSec / 1024).toFixed(1)),
    netOutKB: Number((s.netOutBytesPerSec / 1024).toFixed(1)),
    diskReadKB: Number((s.diskReadBytesPerSec / 1024).toFixed(1)),
    diskWriteKB: Number((s.diskWriteBytesPerSec / 1024).toFixed(1)),
    gpuPct: Number((s.gpuUsedPct ?? 0).toFixed(1)),
    gpuMemGiB: Number(((s.gpuMemUsed ?? 0) / (1024 * 1024 * 1024)).toFixed(2)),
  }));

  const hasGPU = samples.some((s) => (s.gpuCount ?? 0) > 0);
  const latest = data[data.length - 1];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* CPU % */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/70">
        <div className="mb-3 flex items-center justify-between text-xs">
          <span className="font-semibold">CPU Utilization (%)</span>
          <span className="font-mono text-sky-500">{latest.cpuPct}%</span>
        </div>
        <div className="h-52 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" />
              <XAxis dataKey="time" tick={{ fontSize: 10 }} minTickGap={24} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} width={34} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0f172a',
                  border: '1px solid #334155',
                  borderRadius: '8px',
                  fontSize: '11px',
                  color: '#f8fafc',
                }}
              />
              <Area type="monotone" dataKey="cpuPct" name="CPU %" stroke="#0ea5e9" fill="#0ea5e9" fillOpacity={0.18} strokeWidth={2} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Memory GiB */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/70">
        <div className="mb-3 flex items-center justify-between text-xs">
          <span className="font-semibold">Memory Usage (GiB)</span>
          <span className="font-mono text-emerald-500">
            {latest.memGiB} / {latest.memTotalGiB} GiB
          </span>
        </div>
        <div className="h-52 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" />
              <XAxis dataKey="time" tick={{ fontSize: 10 }} minTickGap={24} />
              <YAxis domain={[0, Math.max(1, Math.ceil(latest.memTotalGiB))]} tick={{ fontSize: 10 }} width={34} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0f172a',
                  border: '1px solid #334155',
                  borderRadius: '8px',
                  fontSize: '11px',
                  color: '#f8fafc',
                }}
              />
              <Area type="monotone" dataKey="memGiB" name="Memory (GiB)" stroke="#10b981" fill="#10b981" fillOpacity={0.18} strokeWidth={2} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Network I/O */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/70">
        <div className="mb-3 flex items-center justify-between text-xs">
          <span className="font-semibold">Network I/O (KiB/s)</span>
          <span className="font-mono text-slate-400">
            In {latest.netInKB} · Out {latest.netOutKB} KiB/s
          </span>
        </div>
        <div className="h-52 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" />
              <XAxis dataKey="time" tick={{ fontSize: 10 }} minTickGap={24} />
              <YAxis tick={{ fontSize: 10 }} width={40} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0f172a',
                  border: '1px solid #334155',
                  borderRadius: '8px',
                  fontSize: '11px',
                  color: '#f8fafc',
                }}
              />
              <Legend wrapperStyle={{ fontSize: '11px' }} />
              <Area type="monotone" dataKey="netInKB" name="In (KiB/s)" stroke="#38bdf8" fill="#38bdf8" fillOpacity={0.14} strokeWidth={2} isAnimationActive={false} />
              <Area type="monotone" dataKey="netOutKB" name="Out (KiB/s)" stroke="#a855f7" fill="#a855f7" fillOpacity={0.14} strokeWidth={2} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Disk I/O */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/70">
        <div className="mb-3 flex items-center justify-between text-xs">
          <span className="font-semibold">Disk I/O (KiB/s)</span>
          <span className="font-mono text-slate-400">
            R {latest.diskReadKB} · W {latest.diskWriteKB} KiB/s
          </span>
        </div>
        <div className="h-52 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" />
              <XAxis dataKey="time" tick={{ fontSize: 10 }} minTickGap={24} />
              <YAxis tick={{ fontSize: 10 }} width={40} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0f172a',
                  border: '1px solid #334155',
                  borderRadius: '8px',
                  fontSize: '11px',
                  color: '#f8fafc',
                }}
              />
              <Legend wrapperStyle={{ fontSize: '11px' }} />
              <Area type="monotone" dataKey="diskReadKB" name="Read (KiB/s)" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.14} strokeWidth={2} isAnimationActive={false} />
              <Area type="monotone" dataKey="diskWriteKB" name="Write (KiB/s)" stroke="#f43f5e" fill="#f43f5e" fillOpacity={0.14} strokeWidth={2} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Optional GPU Chart */}
      {hasGPU && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/70 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between text-xs">
            <span className="font-semibold">GPU Utilization (%) &amp; VRAM (GiB)</span>
            <span className="font-mono text-violet-400">
              {latest.gpuPct}% · {latest.gpuMemGiB} GiB VRAM
            </span>
          </div>
          <div className="h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" />
                <XAxis dataKey="time" tick={{ fontSize: 10 }} minTickGap={24} />
                <YAxis tick={{ fontSize: 10 }} width={36} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    border: '1px solid #334155',
                    borderRadius: '8px',
                    fontSize: '11px',
                    color: '#f8fafc',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                <Area type="monotone" dataKey="gpuPct" name="GPU %" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.18} strokeWidth={2} isAnimationActive={false} />
                <Area type="monotone" dataKey="gpuMemGiB" name="VRAM (GiB)" stroke="#ec4899" fill="#ec4899" fillOpacity={0.12} strokeWidth={2} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
