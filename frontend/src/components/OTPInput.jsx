import { useEffect, useRef, useState } from 'react';

export default function OTPInput({ value, onChange, onComplete, disabled, errorSignal }) {
  const inputRef = useRef(null);
  const [shaking, setShaking] = useState(false);
  const lastSignal = useRef(errorSignal);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (errorSignal === lastSignal.current) {
      return undefined;
    }
    lastSignal.current = errorSignal;
    onChange('');
    setShaking(true);
    inputRef.current?.focus();
    const timer = setTimeout(() => setShaking(false), 400);
    return () => clearTimeout(timer);
  }, [errorSignal, onChange]);

  const handleChange = (e) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
    onChange(digits);
    if (digits.length === 6) {
      onComplete(digits);
    }
  };

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={6}
      value={value}
      onChange={handleChange}
      disabled={disabled}
      placeholder="······"
      className={`w-full rounded-md border border-slate-600 bg-slate-700 py-4 text-center text-3xl font-semibold tracking-[0.5em] text-white placeholder:text-slate-500 outline-none focus:border-sky-500 disabled:opacity-50 ${shaking ? 'otp-shake' : ''}`}
    />
  );
}
