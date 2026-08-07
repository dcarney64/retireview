// Pulsing placeholder block for loading states.
export default function Skeleton({ className = '' }) {
  return <div className={`animate-pulse rounded bg-slate-800 ${className}`} aria-hidden="true" />;
}
