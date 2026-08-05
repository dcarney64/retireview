import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import apiClient from '../../api/client';
import OTPInput from '../OTPInput';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

function daysAgo(value) {
  if (!value) return 'never';
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
  if (days === 0) return 'today';
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function BackupCodesGrid({ codes, onDone, doneLabel }) {
  const [saved, setSaved] = useState(false);

  const download = () => {
    const blob = new Blob(
      [`ProjectName backup codes — keep these safe\n\n${codes.join('\n')}\n`],
      { type: 'text/plain' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'projectname-backup-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-300">Save these backup codes in a safe place.
        Each can be used once if you lose access to your authenticator.</p>
      <div className="grid grid-cols-2 gap-2 rounded-md border border-slate-700 bg-slate-900 p-4 font-mono text-sm text-slate-200">
        {codes.map((code) => <div key={code}>{code}</div>)}
      </div>
      <div className="flex gap-3">
        <Button
          className="border border-slate-600 bg-slate-700 text-white hover:bg-slate-600"
          onClick={download}
        >
          Download .txt
        </Button>
        <Button
          className="border border-slate-600 bg-slate-700 text-white hover:bg-slate-600"
          onClick={() => navigator.clipboard.writeText(codes.join('\n'))}
        >
          Copy all
        </Button>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-300">
        <input
          type="checkbox"
          checked={saved}
          onChange={(e) => setSaved(e.target.checked)}
          className="h-4 w-4 rounded border-slate-600 bg-slate-700 accent-sky-500"
        />
        I have saved my backup codes
      </label>
      <Button
        className="w-full bg-sky-500 text-white hover:bg-sky-600"
        disabled={!saved}
        onClick={onDone}
      >
        {doneLabel}
      </Button>
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="mx-4 max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold text-white">{title}</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-200">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function TOTPSetup() {
  const queryClient = useQueryClient();

  const [setup, setSetup] = useState(null);
  const [step, setStep] = useState(1);
  const [code, setCode] = useState('');
  const [errorSignal, setErrorSignal] = useState(0);
  const [error, setError] = useState('');
  const [showDisable, setShowDisable] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [regeneratedCodes, setRegeneratedCodes] = useState(null);

  const statusQuery = useQuery({
    queryKey: ['totp-status'],
    queryFn: async () => (await apiClient.get('/auth/totp/status')).data,
  });

  const refreshStatus = () => queryClient.invalidateQueries({ queryKey: ['totp-status'] });

  const startSetup = useMutation({
    mutationFn: async () => (await apiClient.post('/auth/totp/setup')).data,
    onSuccess: (data) => {
      setSetup(data);
      setStep(1);
      setCode('');
      setError('');
    },
    onError: (err) => setError(err.response?.data?.error || 'Failed to start setup'),
  });

  const verifySetup = useMutation({
    mutationFn: async (otpCode) => apiClient.post('/auth/totp/verify-setup', { code: otpCode }),
    onSuccess: () => {
      setStep(3);
      setError('');
    },
    onError: (err) => {
      setError(err.response?.data?.error || 'Invalid code');
      setErrorSignal((n) => n + 1);
    },
  });

  const disable = useMutation({
    mutationFn: async () => apiClient.post('/auth/totp/disable', { password: disablePassword }),
    onSuccess: () => {
      setShowDisable(false);
      setDisablePassword('');
      setError('');
      refreshStatus();
    },
    onError: (err) => setError(err.response?.data?.error || 'Failed to disable'),
  });

  const regenerate = useMutation({
    mutationFn: async () => (await apiClient.post('/auth/totp/backup-codes/regenerate')).data,
    onSuccess: (data) => setRegeneratedCodes(data.backupCodes),
    onError: (err) => setError(err.response?.data?.error || 'Failed to regenerate codes'),
  });

  const status = statusQuery.data;
  const enabled = status?.enabled;

  const closeSetup = () => {
    setSetup(null);
    setCode('');
    setError('');
    refreshStatus();
  };

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium text-slate-300">Authenticator App</h4>

      {statusQuery.isLoading ? <p className="text-sm text-slate-400">Loading…</p> : null}

      {status && !enabled ? (
        <>
          <p className="text-xs text-slate-500">
            Use Google Authenticator or Authy for stronger 2FA instead of email codes.
          </p>
          <Button
            className="bg-sky-500 text-white hover:bg-sky-600"
            onClick={() => startSetup.mutate()}
            disabled={startSetup.isPending}
          >
            Set up authenticator
          </Button>
        </>
      ) : null}

      {enabled ? (
        <div className="space-y-2 text-sm">
          <p className="text-emerald-400">✓ Authenticator app active</p>
          <p className="text-xs text-slate-400">
            Last used: {daysAgo(status.lastUsedAt)} · Backup codes remaining: {status.backupCodesRemaining}
          </p>
          <div className="flex gap-3 text-xs">
            <button
              type="button"
              onClick={() => regenerate.mutate()}
              disabled={regenerate.isPending}
              className="text-sky-400 hover:underline"
            >
              Regenerate backup codes
            </button>
            <button
              type="button"
              onClick={() => setShowDisable(true)}
              className="text-red-400 hover:underline"
            >
              Disable
            </button>
          </div>
        </div>
      ) : null}

      {error && !setup && !showDisable ? <p className="text-sm text-red-400">{error}</p> : null}

      {setup ? (
        <Modal title={`Set up authenticator (step ${step} of 3)`} onClose={closeSetup}>
          {step === 1 ? (
            <div className="space-y-4">
              <p className="text-sm text-slate-300">
                Scan this QR code with Google Authenticator, Authy, or any TOTP app.
              </p>
              <div className="flex justify-center rounded-md bg-white p-3">
                <img src={setup.qrCodeDataUrl} alt="TOTP QR code" className="h-48 w-48" />
              </div>
              <p className="text-xs text-slate-400">
                Can&apos;t scan? Enter this key manually:
                <span className="mt-1 block break-all font-mono text-slate-200">{setup.secret}</span>
              </p>
              <Button
                className="w-full bg-sky-500 text-white hover:bg-sky-600"
                onClick={() => setStep(2)}
              >
                I&apos;ve scanned the QR code
              </Button>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-4">
              <p className="text-sm text-slate-300">
                Enter the 6-digit code from your authenticator app.
              </p>
              <OTPInput
                value={code}
                onChange={setCode}
                onComplete={(c) => verifySetup.mutate(c)}
                disabled={verifySetup.isPending}
                errorSignal={errorSignal}
              />
              {error ? <p className="text-sm text-red-400">{error}</p> : null}
              <Button
                className="w-full bg-sky-500 text-white hover:bg-sky-600"
                onClick={() => verifySetup.mutate(code)}
                disabled={verifySetup.isPending || code.length !== 6}
              >
                Verify
              </Button>
            </div>
          ) : null}

          {step === 3 ? (
            <BackupCodesGrid
              codes={setup.backupCodes}
              onDone={closeSetup}
              doneLabel="Enable authenticator app"
            />
          ) : null}
        </Modal>
      ) : null}

      {showDisable ? (
        <Modal title="Disable authenticator app?" onClose={() => setShowDisable(false)}>
          <div className="space-y-4">
            <p className="text-sm text-slate-300">
              2FA will fall back to email codes. Confirm your password to continue.
            </p>
            <Input
              type="password"
              placeholder="Password"
              value={disablePassword}
              onChange={(e) => setDisablePassword(e.target.value)}
              className="border-slate-600 bg-slate-700 text-white placeholder:text-slate-400"
            />
            {error ? <p className="text-sm text-red-400">{error}</p> : null}
            <Button
              className="w-full bg-red-700 text-white hover:bg-red-600"
              onClick={() => disable.mutate()}
              disabled={disable.isPending || !disablePassword}
            >
              Disable authenticator
            </Button>
          </div>
        </Modal>
      ) : null}

      {regeneratedCodes ? (
        <Modal title="New backup codes" onClose={() => { setRegeneratedCodes(null); refreshStatus(); }}>
          <BackupCodesGrid
            codes={regeneratedCodes}
            onDone={() => { setRegeneratedCodes(null); refreshStatus(); }}
            doneLabel="Done"
          />
        </Modal>
      ) : null}
    </div>
  );
}
