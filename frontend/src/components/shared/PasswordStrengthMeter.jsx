import { useEffect, useState } from 'react';

// zxcvbn is ~800KB — loaded on demand so it stays out of the main bundle.
let zxcvbnPromise = null;
function loadZxcvbn() {
  if (!zxcvbnPromise) {
    zxcvbnPromise = import('zxcvbn').then((m) => m.default);
  }
  return zxcvbnPromise;
}

const LEVELS = [
  { label: 'Too weak', bar: 'bg-red-500', text: 'text-red-400', width: 'w-1/4' },
  { label: 'Too weak', bar: 'bg-red-500', text: 'text-red-400', width: 'w-1/4' },
  { label: 'Weak', bar: 'bg-orange-500', text: 'text-orange-400', width: 'w-2/4' },
  { label: 'Good', bar: 'bg-yellow-500', text: 'text-yellow-400', width: 'w-3/4' },
  { label: 'Strong', bar: 'bg-emerald-500', text: 'text-emerald-400', width: 'w-full' },
];

export default function PasswordStrengthMeter({ password, userInputs = [] }) {
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!password) {
      setResult(null);
      return undefined;
    }
    let cancelled = false;
    loadZxcvbn().then((zxcvbn) => {
      if (cancelled) return;
      setResult(zxcvbn(password, [
        ...userInputs.filter(Boolean),
        'retireview', // TODO: add your app name and domain words
      ]));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [password, JSON.stringify(userInputs)]);

  if (!password || !result) {
    return null;
  }

  const level = LEVELS[result.score];
  const feedback = result.feedback.warning || result.feedback.suggestions[0] || '';
  const crackTime = result.crack_times_display.offline_slow_hashing_1e4_per_second;

  return (
    <div className="space-y-1">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-700">
        <div className={`h-full rounded-full transition-all ${level.bar} ${level.width}`} />
      </div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className={level.text}>
          {level.label}
          {result.score < 3 && feedback ? ` — ${feedback}` : ''}
        </span>
        <span className="shrink-0 text-slate-400">Would take: {crackTime} to crack</span>
      </div>
      {password.length < 12 ? (
        <p className="text-xs text-slate-400">Must be at least 12 characters</p>
      ) : null}
    </div>
  );
}
