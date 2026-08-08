/**
 * Shared progress bar used across Getting Started, Dashboard setup card,
 * and any future progress indicators.
 *
 * Props:
 *   pct        — 0–100 numeric value
 *   colorClass — Tailwind bg-* class for the filled track (default sky-500)
 *   height     — Tailwind h-* class for the track height (default h-2.5)
 */
export default function ProgressBar({
  pct,
  colorClass = 'bg-sky-500',
  height = 'h-2.5',
}) {
  return (
    <div
      className={`${height} overflow-hidden rounded-full bg-slate-800`}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={`h-full rounded-full transition-all duration-500 ${colorClass}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
