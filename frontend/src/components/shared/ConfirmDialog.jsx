import { useEffect } from 'react';

export default function ConfirmDialog({ isOpen, title, message, confirmLabel, confirmStyle, onConfirm, onCancel }) {
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const confirmBtnClass = confirmStyle === 'warning'
    ? 'rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500'
    : 'rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-600';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="mx-4 w-full max-w-sm rounded-lg border border-slate-700 bg-slate-900 p-6 shadow-xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold text-white">{title}</h3>
        <p className="text-sm text-slate-400">{message}</p>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={confirmBtnClass}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
