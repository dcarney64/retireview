import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const GO_TARGETS = {
  d: { path: '/', label: 'Dashboard' },
  n: { path: '/net-worth', label: 'Net Worth' },
  p: { path: '/performance', label: 'Performance' },
  r: { path: '/real-estate', label: 'Real Estate' },
  t: { path: '/retirement', label: 'Retirement' },
  x: { path: '/tax-planning', label: 'Tax Planning' },
  i: { path: '/income', label: 'Income' },
  a: { path: '/accounts', label: 'Accounts' },
};

const CHORD_TIMEOUT_MS = 1500;

function isTypingTarget(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

/**
 * Global "G then <key>" navigation chords plus a "?" help overlay.
 * Mounted once in Layout; inert while an input has focus.
 */
export default function KeyboardShortcuts() {
  const navigate = useNavigate();
  const [awaitingChord, setAwaitingChord] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    let chordTimer = null;

    function onKeyDown(e) {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === '?') {
        e.preventDefault();
        setShowHelp((s) => !s);
        return;
      }
      if (e.key === 'Escape') {
        setShowHelp(false);
        setAwaitingChord(false);
        return;
      }

      if (awaitingChord) {
        const target = GO_TARGETS[e.key.toLowerCase()];
        setAwaitingChord(false);
        clearTimeout(chordTimer);
        if (target) {
          e.preventDefault();
          navigate(target.path);
        }
        return;
      }

      if (e.key.toLowerCase() === 'g') {
        setAwaitingChord(true);
        clearTimeout(chordTimer);
        chordTimer = setTimeout(() => setAwaitingChord(false), CHORD_TIMEOUT_MS);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      clearTimeout(chordTimer);
    };
  }, [awaitingChord, navigate]);

  return (
    <>
      {awaitingChord ? (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-300 shadow-lg">
          <span className="font-mono text-sky-300">G</span> then… <span className="text-slate-500">(D, N, P, R, T, X, I, A)</span>
        </div>
      ) : null}

      {showHelp ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowHelp(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-4 text-lg font-semibold text-slate-100">Keyboard Shortcuts</h3>
            <div className="space-y-2 text-sm">
              {Object.entries(GO_TARGETS).map(([key, { label }]) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-slate-300">Go to {label}</span>
                  <span className="font-mono text-xs">
                    <kbd className="rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5">G</kbd>
                    {' '}then{' '}
                    <kbd className="rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5">{key.toUpperCase()}</kbd>
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between border-t border-slate-800 pt-2">
                <span className="text-slate-300">Toggle this help</span>
                <kbd className="rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5 font-mono text-xs">?</kbd>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
