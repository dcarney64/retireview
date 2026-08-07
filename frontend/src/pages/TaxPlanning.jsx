import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import apiClient from '../api/client';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { formatCurrency } from '../lib/accountTypes';

const GREEN = '#199e70';
const BLUE = '#3987e5';
const CARD_SURFACE = '#0f172a';

function Field({ id, label, children, hint }) {
  return (
    <div className="space-y-1">
      <label className="block text-sm text-slate-400" htmlFor={id}>{label}</label>
      {children}
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

// ─── Tax bracket visualization ────────────────────────────────────────────────

function BracketBars({ brackets }) {
  return (
    <div className="space-y-2">
      {brackets.map((b) => {
        const size = b.to != null ? b.to - b.from : null;
        const filledPct = size ? Math.min(100, (b.filled / size) * 100) : 0;
        const availablePct = size && b.available ? Math.min(100 - filledPct, (b.available / size) * 100) : 0;
        return (
          <div key={b.rate}>
            <div className="flex items-baseline justify-between text-xs">
              <span className={b.isCurrent ? 'font-medium text-sky-300' : 'text-slate-400'}>
                {b.rate}% bracket
                <span className="ml-2 text-slate-500">
                  {formatCurrency(b.from)} – {b.to != null ? formatCurrency(b.to) : '∞'}
                </span>
              </span>
              <span className="text-slate-500">
                {b.filled > 0 ? `${formatCurrency(b.filled)} filled` : ''}
                {b.isCurrent && b.available > 0 ? (
                  <span className="ml-2 font-medium text-emerald-400">{formatCurrency(b.available)} convert here</span>
                ) : b.available > 0 ? (
                  <span className="ml-2">{formatCurrency(b.available)} available</span>
                ) : null}
              </span>
            </div>
            <div className="mt-1 flex h-4 overflow-hidden rounded bg-slate-800">
              {filledPct > 0 ? <div className="h-full bg-sky-600" style={{ width: `${filledPct}%` }} /> : null}
              {b.isCurrent && availablePct > 0 ? (
                <div className="h-full bg-emerald-500/60" style={{ width: `${availablePct}%` }} />
              ) : null}
            </div>
          </div>
        );
      })}
      <ul className="mt-2 flex gap-4 text-xs text-slate-400">
        <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-sky-600" /> Current income</li>
        <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500/60" /> Conversion headroom</li>
      </ul>
    </div>
  );
}

// ─── Roth conversion section ──────────────────────────────────────────────────

function RothSection({ roth, irmaaCurrent }) {
  const irmaaConflict = roth?.shouldConvert
    && irmaaCurrent?.rothConversionSafeAmount != null
    && irmaaCurrent.rothConversionSafeAmount > 0
    && roth.optimalConversionAmount > irmaaCurrent.rothConversionSafeAmount;

  const cumulative = useMemo(() => {
    if (!roth) return [];
    let running = 0;
    const rateDelta = (roth.retirementMarginalRate - roth.currentMarginalRate) / 100;
    return roth.conversionSchedule.map((row) => {
      running += Math.round(row.convertAmount * Math.max(0, rateDelta));
      return { ...row, runningSavings: running };
    });
  }, [roth]);

  if (!roth) return null;

  return (
    <Card>
      <h3 className="mb-4 text-lg font-semibold">Roth Conversion Optimizer</h3>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Your 2026 Tax Brackets
          </h4>
          <BracketBars brackets={roth.brackets} />
        </div>

        <div className="space-y-3 text-sm">
          <div className={`rounded-lg border p-4 ${roth.shouldConvert ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-slate-700'}`}>
            <div className="text-lg font-semibold text-slate-100">
              {roth.shouldConvert ? '✅ Yes — convert this year' : '— No conversion recommended'}
            </div>
            <p className="mt-1 text-slate-400">{roth.reason}</p>
          </div>

          {roth.shouldConvert ? (
            <>
              <div className="flex justify-between">
                <span className="text-slate-400">Optimal conversion amount</span>
                <span className="font-semibold text-slate-100">{formatCurrency(roth.optimalConversionAmount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Tax cost if you convert now</span>
                <span className="text-slate-200">{formatCurrency(roth.taxCostNow)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Tax cost if you wait until retirement</span>
                <span className="text-slate-200">{formatCurrency(roth.taxCostIfWait)}</span>
              </div>
              <div className="flex justify-between border-t border-slate-800 pt-2">
                <span className="text-slate-300">Estimated savings by converting now</span>
                <span className="font-semibold text-emerald-400">{formatCurrency(roth.taxSavings)}</span>
              </div>

              {irmaaConflict ? (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-amber-300">
                  ⚠ IRMAA warning: converting {formatCurrency(roth.optimalConversionAmount)} would push your
                  income past a Medicare IRMAA threshold. Consider capping this year's conversion at{' '}
                  <span className="font-semibold">{formatCurrency(irmaaCurrent.rothConversionSafeAmount)}</span>{' '}
                  to avoid the surcharge.
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      {roth.conversionSchedule.length > 0 ? (
        <div className="mt-6">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Conversion Schedule
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-slate-400">
                  <th className="py-2 pr-4 font-normal">Year</th>
                  <th className="py-2 pr-4 font-normal">Age</th>
                  <th className="py-2 pr-4 text-right font-normal">Convert</th>
                  <th className="py-2 pr-4 text-right font-normal">Tax Cost</th>
                  <th className="py-2 pr-4 font-normal">Bracket</th>
                  <th className="py-2 text-right font-normal">Running Savings</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {cumulative.map((row) => (
                  <tr key={row.year} className="border-b border-slate-800/40">
                    <td className="py-1.5 pr-4">{row.year}</td>
                    <td className="py-1.5 pr-4">{row.age}</td>
                    <td className="py-1.5 pr-4 text-right font-mono">{formatCurrency(row.convertAmount)}</td>
                    <td className="py-1.5 pr-4 text-right font-mono">{formatCurrency(row.taxCost)}</td>
                    <td className="py-1.5 pr-4">{row.bracketUsed}</td>
                    <td className="py-1.5 text-right font-mono text-emerald-400">{formatCurrency(row.runningSavings)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

// ─── IRMAA section ────────────────────────────────────────────────────────────

function IrmaaSection({ irmaa }) {
  if (!irmaa) return null;
  return (
    <Card>
      <h3 className="mb-1 text-lg font-semibold">🏥 Medicare IRMAA Thresholds</h3>
      <p className="mb-4 text-sm text-slate-400">
        Projected retirement income: <span className="text-slate-200">{formatCurrency(irmaa.projectedIncome)}</span>{' '}
        · Medicare premium at that income: <span className="text-slate-200">${irmaa.currentPremium.toFixed(2)}/mo</span>{' '}
        ({formatCurrency(irmaa.currentAnnualCost)}/yr)
      </p>

      <div className="space-y-1.5">
        {irmaa.tiers.map((t) => (
          <div
            key={t.tier}
            className={`flex items-center gap-3 rounded-md border px-3 py-2 text-sm ${
              t.status === 'current'
                ? 'border-sky-500/50 bg-sky-500/10'
                : t.status === 'next'
                  ? 'border-amber-500/40 bg-amber-500/5'
                  : 'border-slate-800'
            }`}
          >
            <span className="w-14 shrink-0 text-slate-400">{t.tier === 0 ? 'Base' : `Tier ${t.tier}`}</span>
            <span className="text-slate-300">
              {t.threshold != null ? `≤ ${formatCurrency(t.threshold)}` : `Over ${formatCurrency(irmaa.tiers[irmaa.tiers.length - 2].threshold)}`}
            </span>
            {t.status === 'current' ? (
              <span className="text-sky-300">▲ You are here</span>
            ) : null}
            {t.status === 'next' && irmaa.distanceToNextTier != null ? (
              <span className="text-amber-300">← {formatCurrency(irmaa.distanceToNextTier)} away</span>
            ) : null}
            <span className="ml-auto font-mono text-slate-200">${t.premium.toFixed(2)}/mo</span>
            {t.surcharge > 0 ? (
              <span className="w-24 text-right text-xs text-slate-500">+${t.surcharge.toFixed(2)}/mo</span>
            ) : <span className="w-24" />}
          </div>
        ))}
      </div>

      {irmaa.warning ? (
        <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-300">
          ⚠️ {irmaa.warning}
        </div>
      ) : null}

      <p className="mt-4 text-sm text-slate-400">
        Safe Roth conversion amount without triggering the next tier:{' '}
        <span className="font-semibold text-emerald-400">{formatCurrency(irmaa.rothConversionSafeAmount)}</span>
      </p>
    </Card>
  );
}

// ─── Social Security section ──────────────────────────────────────────────────

function SsBarTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm shadow-lg">
      <div className="mb-1 text-xs text-slate-400">Claim at age {d.age}</div>
      <div className="text-slate-300">Monthly: <span className="font-medium text-slate-100">{formatCurrency(d.monthly)}</span></div>
      <div className="text-slate-300">Lifetime: <span className="font-medium text-slate-100">{formatCurrency(d.lifetimeTotal)}</span></div>
    </div>
  );
}

function SocialSecuritySection({ ss }) {
  if (!ss) return null;
  return (
    <Card>
      <h3 className="mb-1 text-lg font-semibold">Social Security Optimizer</h3>
      <p className="mb-4 text-sm text-slate-400">{ss.recommendation}</p>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ss.claimingOptions} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid stroke="#1e293b" vertical={false} />
                <XAxis dataKey="age" tick={{ fill: '#94a3b8', fontSize: 12 }}
                  axisLine={{ stroke: '#334155' }} tickLine={false} />
                <YAxis tickFormatter={(v) => formatCurrency(v, { compact: true })}
                  tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} width={65} />
                <Tooltip content={<SsBarTooltip />} cursor={{ fill: '#1e293b' }} />
                <Bar dataKey="lifetimeTotal" name="Lifetime benefits" radius={[4, 4, 0, 0]}
                  stroke={CARD_SURFACE} strokeWidth={1} isAnimationActive={false}>
                  {ss.claimingOptions.map((o) => (
                    <Cell key={o.age} fill={o.age === ss.optimalAge ? GREEN : BLUE} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-center text-xs text-slate-500">
            Lifetime benefits by claiming age (to age {ss.lifeExpectancy}) — optimal age in green
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-slate-400">
                <th className="py-2 pr-3 font-normal">Age</th>
                <th className="py-2 pr-3 text-right font-normal">Monthly</th>
                <th className="py-2 pr-3 text-right font-normal">Lifetime</th>
                <th className="py-2 pr-3 font-normal">Break-even vs 62</th>
                <th className="py-2 text-right font-normal">After-tax</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {ss.claimingOptions.map((o) => (
                <tr key={o.age} className={`border-b border-slate-800/40 ${o.age === ss.optimalAge ? 'bg-emerald-500/5' : ''}`}>
                  <td className="py-1.5 pr-3">
                    {o.age}{o.age === 67 ? <span className="text-xs text-slate-500"> FRA</span> : ''}
                  </td>
                  <td className="py-1.5 pr-3 text-right font-mono">{formatCurrency(o.monthly)}</td>
                  <td className="py-1.5 pr-3 text-right font-mono">{formatCurrency(o.lifetimeTotal)}</td>
                  <td className="py-1.5 pr-3">{o.breakEvenVs62 ? `Age ${o.breakEvenVs62}` : '—'}</td>
                  <td className="py-1.5 text-right font-mono">
                    {formatCurrency(o.afterTaxMonthly)}
                    {o.age === ss.optimalAge ? <span className="ml-1 text-emerald-400">✓</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {ss.breakEvenVs62 ? (
            <p className="mt-2 text-xs text-slate-500">
              Break-even for age {ss.optimalAge} vs 62: age {ss.breakEvenVs62.age} ({ss.breakEvenVs62.year})
              {ss.breakEvenVs67 ? ` · vs 67: age ${ss.breakEvenVs67.age} (${ss.breakEvenVs67.year})` : ''}
            </p>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TaxPlanning() {
  const [form, setForm] = useState({
    currentIncome: '80000',
    filingStatus: 'single',
    traditionalIraBalance: '',
    rothIraBalance: '',
    currentAge: '',
    retirementAge: '',
    expectedRetirementIncome: '',
    monthlyBenefitAt62: '2800',
    otherRetirementIncome: '',
  });
  const [params, setParams] = useState(null);
  const [prefilled, setPrefilled] = useState(false);

  const accountsQuery = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => (await apiClient.get('/accounts')).data,
  });
  const scenariosQuery = useQuery({
    queryKey: ['scenarios'],
    queryFn: async () => (await apiClient.get('/scenarios')).data,
  });
  const activeScenario = (scenariosQuery.data || []).find((s) => s.is_active) || null;
  const projectionQuery = useQuery({
    queryKey: ['projection', activeScenario?.id, activeScenario?.updated_at],
    queryFn: async () => (await apiClient.get(`/scenarios/${activeScenario.id}/projection`)).data,
    enabled: !!activeScenario,
  });

  // Prefill inputs once from accounts + active scenario, then auto-run
  useEffect(() => {
    if (prefilled || !accountsQuery.data || !activeScenario) return;
    if (activeScenario && !projectionQuery.data) return;

    let traditional = 0;
    let roth = 0;
    for (const a of accountsQuery.data) {
      if (a.archived_at || a.include_in_tracking === false) continue;
      const label = `${a.display_name || ''} ${a.name}`.toLowerCase();
      if (label.includes('roth')) roth += Number(a.balance);
      else if (label.includes('traditional') || label.includes('ira') || label.includes('401')) {
        traditional += Number(a.balance);
      }
    }

    const summary = projectionQuery.data?.summary;
    const annualIncome = summary ? summary.monthlyIncomeAtRetirement * 12 : 0;
    const ssMonthly = Number(activeScenario.social_security_monthly) || 0;

    const next = {
      currentIncome: form.currentIncome,
      filingStatus: 'single',
      traditionalIraBalance: String(Math.round(traditional)),
      rothIraBalance: String(Math.round(roth)),
      currentAge: String(Number(activeScenario.current_age) || 62),
      retirementAge: String(Number(activeScenario.retirement_age) || 67),
      expectedRetirementIncome: String(annualIncome),
      monthlyBenefitAt62: form.monthlyBenefitAt62,
      otherRetirementIncome: String(Math.max(0, annualIncome - ssMonthly * 12)),
    };
    setForm(next);
    setParams(next);
    setPrefilled(true);
  }, [accountsQuery.data, activeScenario, projectionQuery.data, prefilled]);

  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const rothQuery = useQuery({
    queryKey: ['roth-conversion', params],
    queryFn: async () => (await apiClient.get('/tax/roth-conversion', {
      params: {
        currentIncome: params.currentIncome,
        filingStatus: params.filingStatus,
        traditionalIraBalance: params.traditionalIraBalance,
        rothIraBalance: params.rothIraBalance,
        currentAge: params.currentAge,
        retirementAge: params.retirementAge,
        expectedRetirementIncome: params.expectedRetirementIncome,
      },
    })).data,
    enabled: !!params,
  });

  // Retirement-income IRMAA (the main section)
  const irmaaQuery = useQuery({
    queryKey: ['irmaa-retirement', params],
    queryFn: async () => (await apiClient.get('/tax/irmaa', {
      params: { projectedIncome: params.expectedRetirementIncome, filingStatus: params.filingStatus },
    })).data,
    enabled: !!params,
  });

  // Current-income IRMAA — used to bound this year's Roth conversion
  const irmaaCurrentQuery = useQuery({
    queryKey: ['irmaa-current', params],
    queryFn: async () => (await apiClient.get('/tax/irmaa', {
      params: { projectedIncome: params.currentIncome, filingStatus: params.filingStatus },
    })).data,
    enabled: !!params,
  });

  const ssQuery = useQuery({
    queryKey: ['social-security', params],
    queryFn: async () => (await apiClient.get('/tax/social-security', {
      params: {
        monthlyBenefitAt62: params.monthlyBenefitAt62,
        currentAge: params.currentAge,
        filingStatus: params.filingStatus,
        otherIncome: params.otherRetirementIncome,
        lifeExpectancy: activeScenario ? Number(activeScenario.life_expectancy) || 90 : 90,
      },
    })).data,
    enabled: !!params,
  });

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Tax Planning</h2>

      <Card>
        <h3 className="mb-4 text-lg font-semibold">Your Situation</h3>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Field id="tax-income" label="Current annual income ($)">
            <Input id="tax-income" type="number" min="0" step="1000" value={form.currentIncome} onChange={set('currentIncome')} />
          </Field>
          <Field id="tax-status" label="Filing status">
            <select
              id="tax-status"
              value={form.filingStatus}
              onChange={set('filingStatus')}
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
            >
              <option value="single">Single</option>
              <option value="married">Married filing jointly</option>
            </select>
          </Field>
          <Field id="tax-trad" label="Traditional IRA / 401k ($)" hint="Auto-detected from accounts">
            <Input id="tax-trad" type="number" min="0" step="1000" value={form.traditionalIraBalance} onChange={set('traditionalIraBalance')} />
          </Field>
          <Field id="tax-roth" label="Roth IRA balance ($)" hint="Auto-detected from accounts">
            <Input id="tax-roth" type="number" min="0" step="1000" value={form.rothIraBalance} onChange={set('rothIraBalance')} />
          </Field>
          <Field id="tax-ret-income" label="Expected retirement income ($/yr)" hint="From active scenario">
            <Input id="tax-ret-income" type="number" min="0" step="1000" value={form.expectedRetirementIncome} onChange={set('expectedRetirementIncome')} />
          </Field>
          <Field id="tax-ss62" label="SS benefit at 62 ($/mo)">
            <Input id="tax-ss62" type="number" min="0" step="100" value={form.monthlyBenefitAt62} onChange={set('monthlyBenefitAt62')} />
          </Field>
          <Field id="tax-other" label="Other retirement income ($/yr)" hint="Excluding Social Security">
            <Input id="tax-other" type="number" min="0" step="1000" value={form.otherRetirementIncome} onChange={set('otherRetirementIncome')} />
          </Field>
          <div className="flex items-end">
            <Button onClick={() => setParams({ ...form })} className="w-full">Calculate</Button>
          </div>
        </div>
      </Card>

      {!params ? (
        <Card>
          <p className="py-8 text-center text-sm text-slate-400">
            {scenariosQuery.isLoading || accountsQuery.isLoading
              ? 'Loading your data…'
              : 'Review the inputs above and press Calculate to analyze Roth conversions, IRMAA exposure, and Social Security timing.'}
          </p>
        </Card>
      ) : (
        <>
          {rothQuery.isLoading ? (
            <Card><p className="py-8 text-center text-sm text-slate-400">Analyzing Roth conversion…</p></Card>
          ) : (
            <RothSection roth={rothQuery.data} irmaaCurrent={irmaaCurrentQuery.data} />
          )}
          <IrmaaSection irmaa={irmaaQuery.data} />
          <SocialSecuritySection ss={ssQuery.data} />
        </>
      )}
    </div>
  );
}
