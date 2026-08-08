import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Rocket,
  Square,
  Users,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

import apiClient from '../api/client';
import { Card } from '../components/ui/card';
import { useActiveProfile } from '../store/useActiveProfile';
import { useProfileStore } from '../store/profileStore';

const SKIP_KEY = 'retireview:setup_skipped';

// ─── Small helpers ────────────────────────────────────────────────────────────

function StatusIcon({ status, size = 20 }) {
  if (status === 'complete')
    return <CheckCircle2 size={size} className="shrink-0 text-emerald-400" />;
  if (status === 'partial')
    return <AlertTriangle size={size} className="shrink-0 text-amber-400" />;
  return <Square size={size} className="shrink-0 text-slate-600" />;
}

function ProgressBar({ pct, colorClass = 'bg-sky-500' }) {
  return (
    <div
      className="h-2.5 overflow-hidden rounded-full bg-slate-800"
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

// ─── Step card ────────────────────────────────────────────────────────────────

function StepCard({ step }) {
  const actionLabel =
    step.status === 'complete' ? 'Manage' :
    step.status === 'partial'  ? 'Complete' :
    'Start';

  const borderClass =
    step.status === 'complete' ? 'border-emerald-800/40' :
    step.status === 'partial'  ? 'border-amber-800/50' :
    'border-slate-800';

  const labelClass =
    step.status === 'complete' ? 'text-emerald-300' :
    step.status === 'partial'  ? 'text-amber-200' :
    'text-slate-200';

  return (
    <div className={`flex items-start gap-4 rounded-lg border ${borderClass} bg-slate-900 px-4 py-3.5`}>
      <div className="mt-0.5">
        <StatusIcon status={step.status} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-sm font-medium ${labelClass}`}>{step.label}</span>
          {!step.minimumRequired && (
            <span className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-500">
              Optional
            </span>
          )}
          {step.minimumRequired && step.status !== 'complete' && (
            <span className="rounded border border-sky-900 px-1.5 py-0.5 text-[10px] text-sky-500">
              Needed to start
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-slate-500">{step.countLabel}</p>
        {step.status === 'empty' && (
          <p className="mt-0.5 text-xs text-slate-600">{step.description}</p>
        )}
      </div>

      <Link
        to={step.path}
        className="mt-0.5 flex shrink-0 items-center gap-1 text-xs text-sky-400 hover:text-sky-300 whitespace-nowrap"
      >
        {actionLabel} <ChevronRight size={13} />
      </Link>
    </div>
  );
}

// ─── Household row ────────────────────────────────────────────────────────────

function HouseholdRow({ profileStatus, isCurrent, onSwitch }) {
  const pct = profileStatus?.overallPct ?? 0;
  return (
    <div className="flex items-center gap-3">
      <span
        className={`w-16 shrink-0 text-sm truncate ${isCurrent ? 'font-medium text-slate-100' : 'text-slate-400'}`}
        title={profileStatus.profileName}
      >
        {profileStatus.profileName}
      </span>
      <div className="flex-1">
        <ProgressBar pct={pct} colorClass={isCurrent ? 'bg-sky-500' : 'bg-slate-600'} />
      </div>
      <span className="w-24 shrink-0 text-right text-xs text-slate-500">{pct}% complete</span>
      {!isCurrent && (
        <button
          type="button"
          className="shrink-0 text-xs text-sky-400 hover:text-sky-300"
          onClick={() => onSwitch(profileStatus.profileId)}
        >
          Switch →
        </button>
      )}
    </div>
  );
}

// ─── Unlock hints ─────────────────────────────────────────────────────────────

function UnlockSection({ steps }) {
  const incomeStep   = steps.find((s) => s.id === 'income');
  const expensesStep = steps.find((s) => s.id === 'expenses');

  const showIncome   = incomeStep?.status   !== 'complete';
  const showExpenses = expensesStep?.status !== 'complete';

  if (!showIncome && !showExpenses) return null;

  return (
    <Card className="p-5">
      <h2 className="mb-4 text-sm font-semibold text-slate-400 uppercase tracking-wide">
        What you'll unlock
      </h2>
      <div className="space-y-4 text-sm">
        {showIncome && (
          <div>
            <p className="mb-1.5 text-slate-400">
              <Link to="/income" className="text-sky-400 hover:underline">
                Add income sources
              </Link>{' '}
              to unlock:
            </p>
            <ul className="ml-4 list-disc space-y-0.5 text-slate-500">
              <li>Retirement gap calculator</li>
              <li>Cash flow before and after retirement</li>
              <li>Monthly income projection by age</li>
            </ul>
          </div>
        )}
        {showExpenses && (
          <div>
            <p className="mb-1.5 text-slate-400">
              <Link to="/cash-flow" className="text-sky-400 hover:underline">
                Add monthly expenses
              </Link>{' '}
              to unlock:
            </p>
            <ul className="ml-4 list-disc space-y-0.5 text-slate-500">
              <li>Disposable income calculator</li>
              <li>Pre vs post retirement cash flow</li>
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function GettingStarted() {
  const navigate         = useNavigate();
  const queryClient      = useQueryClient();
  const pid              = useActiveProfile();
  const profiles         = useProfileStore((state) => state.profiles);
  const setActiveProfile = useProfileStore((state) => state.setActiveProfile);

  // Active profile setup status
  const statusQuery = useQuery({
    queryKey: ['setup-status', pid],
    queryFn:  async () => (await apiClient.get('/setup/status')).data,
    staleTime: 15_000,
  });

  // All-profiles status for household section
  const householdQuery = useQuery({
    queryKey: ['setup-all-profiles'],
    queryFn:  async () => (await apiClient.get('/setup/all-profiles')).data,
    staleTime: 30_000,
    enabled:  profiles.length > 1,
  });

  const status          = statusQuery.data;
  const householdStatus = householdQuery.data ?? [];

  function handleSkip() {
    try { localStorage.setItem(SKIP_KEY, 'true'); } catch { /* ignore */ }
    navigate('/');
  }

  function handleSwitchProfile(profileId) {
    setActiveProfile(profileId);
    queryClient.invalidateQueries();
    navigate('/getting-started');
  }

  // ── Loading / error states ──────────────────────────────────────────────────
  if (statusQuery.isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Rocket size={22} className="text-sky-400" />
          <h1 className="text-2xl font-semibold">Getting Started</h1>
        </div>
        <p className="text-sm text-slate-400">Loading your setup progress…</p>
      </div>
    );
  }

  if (statusQuery.isError || !status) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Rocket size={22} className="text-sky-400" />
          <h1 className="text-2xl font-semibold">Getting Started</h1>
        </div>
        <p className="text-sm text-rose-400">
          Failed to load setup status.{' '}
          <button
            type="button"
            className="underline hover:text-rose-300"
            onClick={() => statusQuery.refetch()}
          >
            Try again
          </button>
        </p>
      </div>
    );
  }

  const hasMultipleProfiles = profiles.length > 1;
  const otherProfiles = householdStatus.filter((p) => p.profileId !== pid);

  return (
    <div className="max-w-2xl space-y-8">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-3">
          <Rocket size={22} className="text-sky-400" />
          <h1 className="text-2xl font-semibold text-slate-100">Getting Started</h1>
        </div>
        <p className="mt-1 text-sm text-slate-400">
          {status.profileName}'s setup is{' '}
          <span className="font-medium text-slate-200">{status.overallPct}% complete</span>
        </p>
      </div>

      {/* ── Progress card ──────────────────────────────────────────────────── */}
      <Card className="p-5">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="text-slate-400">Overall progress</span>
          <span className="font-medium text-slate-200">{status.overallPct}%</span>
        </div>
        <ProgressBar pct={status.overallPct} />

        <div className="mt-4">
          {status.isMinimumComplete ? (
            <div className="flex items-center gap-2 text-sm text-emerald-400">
              <CheckCircle2 size={15} />
              <span>Minimum setup complete — your dashboard is ready!</span>
            </div>
          ) : (
            <p className="text-sm text-amber-400">
              Add at least 1 account or property, plus a retirement scenario to unlock your full dashboard.
            </p>
          )}
          {status.isMinimumComplete && status.overallPct < 100 && (
            <p className="mt-1 text-xs text-slate-500">
              Complete more steps for a fuller financial picture.
            </p>
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            className="text-xs text-slate-500 hover:text-slate-400 transition-colors"
            onClick={handleSkip}
          >
            Skip for now →
          </button>
        </div>
      </Card>

      {/* ── Checklist ──────────────────────────────────────────────────────── */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Setup checklist
        </h2>
        <div className="space-y-2">
          {status.steps.map((step) => (
            <StepCard key={step.id} step={step} />
          ))}
        </div>
      </div>

      {/* ── What you'll unlock ─────────────────────────────────────────────── */}
      <UnlockSection steps={status.steps} />

      {/* ── Household section ──────────────────────────────────────────────── */}
      {hasMultipleProfiles && (
        <Card className="p-5">
          <div className="mb-4 flex items-center gap-2">
            <Users size={16} className="text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-300">Household Setup</h2>
          </div>

          {householdQuery.isLoading ? (
            <p className="text-xs text-slate-500">Loading household progress…</p>
          ) : (
            <div className="space-y-4">
              {householdStatus.map((ps) => (
                <HouseholdRow
                  key={ps.profileId}
                  profileStatus={ps}
                  isCurrent={ps.profileId === pid}
                  onSwitch={handleSwitchProfile}
                />
              ))}
            </div>
          )}

          {otherProfiles.length > 0 && (
            <p className="mt-4 text-xs text-slate-500">
              Switch to{' '}
              {otherProfiles.map((p, i) => (
                <span key={p.profileId}>
                  {i > 0 && ' or '}
                  <button
                    type="button"
                    className="text-sky-400 hover:underline"
                    onClick={() => handleSwitchProfile(p.profileId)}
                  >
                    {p.profileName}'s profile
                  </button>
                </span>
              ))}{' '}
              to continue their setup →
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
