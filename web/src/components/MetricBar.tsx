export function MetricBar({
  label,
  pct,
  color = 'sky',
  detail,
}: {
  label: string;
  pct: number;
  color?: 'sky' | 'emerald' | 'violet';
  detail?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  let fillClass = 'bg-sky-500';
  if (clamped >= 90) {
    fillClass = 'bg-rose-500';
  } else if (clamped >= 80) {
    fillClass = 'bg-amber-500';
  } else if (color === 'emerald') {
    fillClass = 'bg-emerald-500';
  } else if (color === 'violet') {
    fillClass = 'bg-violet-500';
  }

  return (
    <div className="flex items-center gap-2 text-xs font-mono">
      <span className="w-8 shrink-0 text-[11px] text-slate-500 dark:text-slate-400">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
        <div className={`h-full rounded-full transition-all duration-300 ${fillClass}`} style={{ width: `${clamped}%` }} />
      </div>
      <span className="w-10 shrink-0 text-right text-[11px] text-slate-700 dark:text-slate-300" title={detail}>
        {Math.round(clamped)}%
      </span>
    </div>
  );
}
