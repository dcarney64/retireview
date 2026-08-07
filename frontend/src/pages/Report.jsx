import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { Link } from 'react-router-dom';

import apiClient from '../api/client';
import { Button } from '../components/ui/button';
import { formatCurrency } from '../lib/accountTypes';
import { typeLabel } from '../lib/accountTypes';

// Printable summary report. On screen it uses the dark theme; @media print
// styles (in index.css) flip it to black-on-white.
export default function Report() {
  const reportQuery = useQuery({
    queryKey: ['report-summary'],
    queryFn: async () => (await apiClient.get('/reports/summary')).data,
  });

  if (reportQuery.isLoading) {
    return <p className="py-12 text-center text-sm text-slate-400">Building report…</p>;
  }
  if (reportQuery.isError || !reportQuery.data) {
    return (
      <div className="py-12 text-center text-sm">
        <p className="text-red-400">Unable to build the report. Check your connection and try again.</p>
        <Button className="mt-3" onClick={() => reportQuery.refetch()}>Retry</Button>
      </div>
    );
  }

  const r = reportQuery.data;

  return (
    <div className="print-report mx-auto max-w-3xl space-y-8">
      <div className="flex items-start justify-between print:hidden">
        <Link to="/" className="text-sm text-sky-400 hover:underline">← Back to Dashboard</Link>
        <Button onClick={() => window.print()} className="flex items-center gap-2">
          <Printer size={16} /> Print Report
        </Button>
      </div>

      <header>
        <h1 className="text-3xl font-semibold">RetireView Summary Report</h1>
        <p className="mt-1 text-sm text-slate-400">
          {r.user.name || r.user.email} · Generated{' '}
          {new Date(r.generatedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
        </p>
      </header>

      <section>
        <h2 className="mb-3 border-b border-slate-700 pb-1 text-xl font-semibold">Net Worth</h2>
        <div className="text-4xl font-semibold">{formatCurrency(r.netWorth.total)}</div>
        <table className="mt-4 w-full text-sm">
          <tbody>
            <tr>
              <td className="py-1 text-slate-400">Liquid investments</td>
              <td className="py-1 text-right font-medium">{formatCurrency(r.netWorth.liquid)}</td>
            </tr>
            <tr>
              <td className="py-1 text-slate-400">Real estate (market value)</td>
              <td className="py-1 text-right font-medium">{formatCurrency(r.netWorth.realEstateValue)}</td>
            </tr>
            <tr>
              <td className="py-1 text-slate-400">Mortgage debt</td>
              <td className="py-1 text-right font-medium">−{formatCurrency(r.netWorth.realEstateMortgage)}</td>
            </tr>
            <tr className="border-t border-slate-700">
              <td className="py-1 font-medium">Real estate equity</td>
              <td className="py-1 text-right font-medium">{formatCurrency(r.netWorth.realEstateEquity)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="mb-3 border-b border-slate-700 pb-1 text-xl font-semibold">Accounts</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400">
              <th className="py-1 font-normal">Account</th>
              <th className="py-1 font-normal">Type</th>
              <th className="py-1 text-right font-normal">Balance</th>
            </tr>
          </thead>
          <tbody>
            {r.accounts.map((a, i) => (
              <tr key={i} className="border-t border-slate-800">
                <td className="py-1.5">{a.name}</td>
                <td className="py-1.5 text-slate-400">{typeLabel(a.type)}</td>
                <td className="py-1.5 text-right font-mono">{formatCurrency(a.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {r.properties.length > 0 ? (
        <section>
          <h2 className="mb-3 border-b border-slate-700 pb-1 text-xl font-semibold">Real Estate</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400">
                <th className="py-1 font-normal">Property</th>
                <th className="py-1 text-right font-normal">Value</th>
                <th className="py-1 text-right font-normal">Mortgage</th>
                <th className="py-1 text-right font-normal">Equity</th>
              </tr>
            </thead>
            <tbody>
              {r.properties.map((p, i) => (
                <tr key={i} className="border-t border-slate-800">
                  <td className="py-1.5">{p.name}</td>
                  <td className="py-1.5 text-right font-mono">{formatCurrency(p.estimated_value)}</td>
                  <td className="py-1.5 text-right font-mono">{formatCurrency(p.mortgage_balance)}</td>
                  <td className="py-1.5 text-right font-mono">{formatCurrency(p.equity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {r.projection ? (
        <section>
          <h2 className="mb-3 border-b border-slate-700 pb-1 text-xl font-semibold">
            Retirement Outlook{r.activeScenario ? ` — ${r.activeScenario} scenario` : ''}
          </h2>
          <table className="w-full text-sm">
            <tbody>
              <tr>
                <td className="py-1 text-slate-400">Estimated monthly income at retirement</td>
                <td className="py-1 text-right font-medium">{formatCurrency(r.projection.monthlyIncomeAtRetirement)}/mo</td>
              </tr>
              <tr>
                <td className="py-1 text-slate-400">Projected portfolio at retirement</td>
                <td className="py-1 text-right font-medium">{formatCurrency(r.projection.portfolioAtRetirement)}</td>
              </tr>
              <tr>
                <td className="py-1 text-slate-400">Projected portfolio at end of plan</td>
                <td className="py-1 text-right font-medium">{formatCurrency(r.projection.portfolioAtEndOfLife)}</td>
              </tr>
              <tr>
                <td className="py-1 text-slate-400">Portfolio depletion</td>
                <td className="py-1 text-right font-medium">
                  {r.projection.portfolioRunsOut ? `Runs out in ${r.projection.portfolioRunsOut}` : 'Never runs out'}
                </td>
              </tr>
              {r.goalProgressPct != null ? (
                <tr>
                  <td className="py-1 text-slate-400">Progress toward retirement target</td>
                  <td className="py-1 text-right font-medium">{r.goalProgressPct.toFixed(1)}%</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>
      ) : null}

      <footer className="border-t border-slate-800 pt-4 text-xs text-slate-500">
        Generated by RetireView. Projections are estimates based on your scenario assumptions, not guarantees.
      </footer>
    </div>
  );
}
