import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';

import OTPInput from '../components/OTPInput';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { useAuthStore } from '../store/authStore';

const RESEND_COOLDOWN_SECONDS = 60;

function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export default function Login() {
  const navigate = useNavigate();
  const login = useAuthStore((state) => state.login);
  const verify2FA = useAuthStore((state) => state.verify2FA);
  const resend2FA = useAuthStore((state) => state.resend2FA);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [twoFA, setTwoFA] = useState(null);
  const [method, setMethod] = useState('email_otp');
  const [backupMode, setBackupMode] = useState(false);
  const [code, setCode] = useState('');
  const [trustDevice, setTrustDevice] = useState(true);
  const [errorSignal, setErrorSignal] = useState(0);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!twoFA) {
      return undefined;
    }
    const timer = setInterval(() => {
      setNow(Date.now());
      setResendCooldown((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [twoFA]);

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  const finishLogin = () => {
    navigate('/');
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await login(email, password);
      if (result?.requires2FA) {
        setTwoFA(result);
        setMethod(result.method || 'email_otp');
        setBackupMode(false);
        setCode('');
        setResendCooldown(result.method === 'totp' ? 0 : RESEND_COOLDOWN_SECONDS);
      } else {
        finishLogin();
      }
    } catch (_err) {
      setError('Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  const onVerify = async (submittedCode) => {
    const otpCode = submittedCode || code;
    if ((backupMode ? otpCode.length !== 8 : otpCode.length !== 6) || loading) {
      return;
    }
    setError('');
    setLoading(true);
    try {
      await verify2FA(twoFA.tempToken, otpCode, trustDevice);
      finishLogin();
    } catch (err) {
      setError(err.response?.data?.error || 'Verification failed');
      setErrorSignal((n) => n + 1);
    } finally {
      setLoading(false);
    }
  };

  const onResend = async () => {
    setError('');
    try {
      const result = await resend2FA(twoFA.tempToken);
      setTwoFA((prev) => ({ ...prev, ...result }));
      setMethod('email_otp');
      setBackupMode(false);
      setCode('');
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to resend code');
    }
  };

  const backToLogin = () => {
    setTwoFA(null);
    setBackupMode(false);
    setCode('');
    setError('');
    setPassword('');
  };

  const expiresIn = twoFA?.expiresAt ? new Date(twoFA.expiresAt).getTime() - now : 0;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-6 text-slate-100">
      <Card className="w-full max-w-md border-slate-700 bg-slate-800 text-white">
        <div className="mb-6 text-center">
          {/* TODO: replace with your app name and tagline */}
          <h1 className="mb-2 text-3xl font-semibold tracking-tight text-white">RetireView</h1>
          <p className="text-sm text-slate-300">Sign in to your account</p>
        </div>

        {twoFA ? (
          <div className="space-y-4">
            <div className="text-center">
              {backupMode ? (
                <>
                  <h2 className="mb-1 text-xl font-semibold text-white">Enter a backup code</h2>
                  <p className="text-sm text-slate-300">Use one of the 8-character backup codes you saved</p>
                </>
              ) : method === 'totp' ? (
                <>
                  <h2 className="mb-1 text-xl font-semibold text-white">Authenticator code</h2>
                  <p className="text-sm text-slate-300">Enter the 6-digit code from your authenticator app</p>
                </>
              ) : (
                <>
                  <h2 className="mb-1 text-xl font-semibold text-white">Check your email</h2>
                  <p className="text-sm text-slate-300">
                    We sent a 6-digit code to <span className="font-medium text-white">{twoFA.maskedEmail}</span>
                  </p>
                </>
              )}
            </div>

            {backupMode ? (
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 8).toUpperCase())}
                placeholder="XXXXXXXX"
                autoFocus
                className="border-slate-600 bg-slate-700 py-4 text-center font-mono text-2xl tracking-[0.3em] text-white placeholder:text-slate-500"
              />
            ) : (
              <OTPInput
                value={code}
                onChange={setCode}
                onComplete={onVerify}
                disabled={loading || (method === 'email_otp' && expiresIn <= 0)}
                errorSignal={errorSignal}
              />
            )}

            {method === 'email_otp' && !backupMode ? (
              <p className="text-center text-sm text-slate-400">
                {expiresIn > 0 ? `Code expires in ${formatCountdown(expiresIn)}` : 'Code expired — resend to get a new one'}
              </p>
            ) : null}

            <label className="flex items-center justify-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={trustDevice}
                onChange={(e) => setTrustDevice(e.target.checked)}
                className="h-4 w-4 rounded border-slate-600 bg-slate-700 accent-sky-500"
              />
              Trust this device for 30 days
            </label>

            {error ? <p className="text-center text-sm text-red-400">{error}</p> : null}

            <Button
              className="w-full bg-sky-500 text-white hover:bg-sky-600"
              onClick={() => onVerify()}
              disabled={loading || code.length !== (backupMode ? 8 : 6)}
            >
              {loading ? 'Verifying...' : 'Verify'}
            </Button>

            {method === 'totp' && !backupMode ? (
              <div className="space-y-1 text-center text-sm">
                <button type="button" onClick={onResend} className="block w-full text-sky-400 hover:underline">
                  Use email code instead
                </button>
                <button
                  type="button"
                  onClick={() => { setBackupMode(true); setCode(''); setError(''); }}
                  className="block w-full text-slate-400 hover:text-slate-200"
                >
                  Lost your authenticator? Use a backup code
                </button>
              </div>
            ) : null}

            {backupMode ? (
              <button
                type="button"
                onClick={() => { setBackupMode(false); setCode(''); setError(''); }}
                className="block w-full text-center text-sm text-slate-400 hover:text-slate-200"
              >
                ← Back to authenticator code
              </button>
            ) : null}

            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={backToLogin}
                className="text-slate-400 hover:text-slate-200"
              >
                ← Back to login
              </button>
              {method === 'email_otp' ? (
                <button
                  type="button"
                  onClick={onResend}
                  disabled={resendCooldown > 0}
                  className="text-sky-400 hover:underline disabled:cursor-not-allowed disabled:text-slate-500 disabled:no-underline"
                >
                  {resendCooldown > 0 ? `Resend code (${resendCooldown}s)` : 'Resend code'}
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <>
            <form className="space-y-4" onSubmit={onSubmit}>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-200" htmlFor="email">
                  Email
                </label>
                <Input
                  id="email"
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="border-slate-600 bg-slate-700 text-white placeholder:text-slate-400"
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-200" htmlFor="password">
                  Password
                </label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="border-slate-600 bg-slate-700 text-white placeholder:text-slate-400"
                  required
                />
              </div>

              {error ? <p className="text-sm text-red-400">{error}</p> : null}

              <Button className="w-full bg-sky-500 text-white hover:bg-sky-600" type="submit" disabled={loading}>
                {loading ? 'Signing In...' : 'Sign In'}
              </Button>
            </form>

            <p className="mt-4 text-center text-sm text-slate-400">
              Don&apos;t have an account?{' '}
              <a href="/signup" className="text-sky-400 hover:underline">
                Sign up
              </a>
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
