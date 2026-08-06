import { formatCurrency } from '../../lib/accountTypes';

// Map a single broker-initial letter to a Tailwind bg class.
// Used by both ConnectionCard and calling pages.
export const AVATAR_COLORS = {
  F: 'bg-indigo-600',  // Fidelity
  S: 'bg-blue-600',    // Schwab
  A: 'bg-green-600',   // Alpaca
  I: 'bg-orange-600',  // IBKR / Interactive Brokers
  C: 'bg-emerald-600', // Composer
  T: 'bg-amber-600',   // TSP
};

export function avatarColorFor(letter) {
  return AVATAR_COLORS[String(letter || '').toUpperCase()] || 'bg-slate-600';
}

// Derives the avatar letter + color from an institution or account name string.
const INSTITUTION_MAP = [
  { key: 'fidelity',             letter: 'F', color: 'bg-indigo-600' },
  { key: 'schwab',               letter: 'S', color: 'bg-blue-600'   },
  { key: 'alpaca',               letter: 'A', color: 'bg-green-600'  },
  { key: 'ibkr',                 letter: 'I', color: 'bg-orange-600' },
  { key: 'interactive brokers',  letter: 'I', color: 'bg-orange-600' },
  { key: 'tsp',                  letter: 'T', color: 'bg-amber-600'  },
  { key: 'thrift savings',       letter: 'T', color: 'bg-amber-600'  },
  { key: 'composer',             letter: 'C', color: 'bg-emerald-600'},
];

export function institutionAvatar(institution, fallbackName = '') {
  const src = (institution || fallbackName || '').toLowerCase();
  for (const entry of INSTITUTION_MAP) {
    if (src.includes(entry.key)) return { letter: entry.letter, color: entry.color };
  }
  const letter = (institution || fallbackName || '?')[0].toUpperCase();
  return { letter, color: avatarColorFor(letter) };
}

// ─── ConnectionCard ───────────────────────────────────────────────────────────
//
// Props:
//   broker      — display name (e.g. "Fidelity", "Composer")
//   badge       — short label shown after the name (e.g. "SnapTrade", "Direct API")
//   badgeColor  — Tailwind classes for the badge pill  (default: cyan)
//   avatar      — single letter rendered inside the avatar circle
//   avatarColor — Tailwind bg class for the avatar (e.g. "bg-indigo-600")
//   balance     — numeric balance (optional; hidden when null/undefined)
//   syncedAt    — ISO timestamp string (optional)
//   connected   — boolean; drives connected/disconnected visual style (default true)
//   children    — slot for action buttons / inline forms
export default function ConnectionCard({
  broker,
  badge,
  badgeColor = 'bg-cyan-500/15 text-cyan-300',
  avatar,
  avatarColor = 'bg-slate-600',
  balance,
  syncedAt,
  connected = true,
  children,
}) {
  return (
    <div
      className={`rounded-xl border p-5 transition-colors ${
        connected
          ? 'border-slate-700 bg-slate-800/60'
          : 'border-slate-800 bg-slate-900/40'
      }`}
    >
      {/* Header row */}
      <div className="flex items-start gap-4">
        {/* Letter avatar */}
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full
            text-sm font-bold text-white ${avatarColor}
            ${!connected ? 'opacity-40' : ''}`}
        >
          {String(avatar || '?').toUpperCase()}
        </div>

        {/* Broker name + badges */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`font-semibold ${connected ? 'text-slate-100' : 'text-slate-400'}`}>
              {broker}
            </span>

            {badge ? (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${badgeColor}`}>
                {badge}
              </span>
            ) : null}

            {!connected ? (
              <span className="rounded-full bg-slate-700/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                Not connected
              </span>
            ) : null}
          </div>

          {/* Balance + sync time */}
          {connected && balance != null ? (
            <div className="mt-0.5 text-sm text-slate-400">
              {formatCurrency(balance)}
              {syncedAt ? (
                <span className="ml-2 text-xs text-slate-500">
                  · synced {new Date(syncedAt).toLocaleString()}
                </span>
              ) : (
                <span className="ml-2 text-xs text-slate-500">· never synced</span>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {/* Action slot */}
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}
