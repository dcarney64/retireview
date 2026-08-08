import { CheckSquare, Square } from 'lucide-react';

/**
 * IncludeToggle — consistent "Included / Excluded" button used on every
 * financial item card across the app.
 *
 * Props:
 *   included  boolean  — current state
 *   onToggle  fn       — called with the NEW boolean value when clicked
 *   size      'sm'|'md' — default 'sm'
 *   disabled  boolean  — optional, grays out while a mutation is in-flight
 */
export default function IncludeToggle({ included, onToggle, size = 'sm', disabled = false }) {
  const iconSize = size === 'md' ? 16 : 14;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onToggle(!included)}
      title={included ? 'Exclude from calculations' : 'Include in calculations'}
      className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
        included
          ? 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
          : 'bg-slate-700/60 text-slate-500 hover:bg-slate-700 hover:text-slate-300'
      }`}
    >
      {included ? (
        <CheckSquare size={iconSize} className="shrink-0" />
      ) : (
        <Square size={iconSize} className="shrink-0" />
      )}
      {included ? 'Included' : 'Excluded'}
    </button>
  );
}
