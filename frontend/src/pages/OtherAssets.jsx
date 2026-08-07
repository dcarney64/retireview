import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Briefcase } from 'lucide-react';
import { useState } from 'react';

import apiClient from '../api/client';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { formatCurrency } from '../lib/accountTypes';

const ASSET_TYPES = [
  { value: 'business', label: 'Business', emoji: '🏢' },
  { value: 'intellectual_property', label: 'Intellectual Property', emoji: '🔷' },
  { value: 'vehicle', label: 'Vehicle', emoji: '🚗' },
  { value: 'collectible', label: 'Collectible', emoji: '🎨' },
  { value: 'equipment', label: 'Equipment', emoji: '⚙️' },
  { value: 'other', label: 'Other', emoji: '📦' },
];

function typeMeta(type) {
  return ASSET_TYPES.find((t) => t.value === type) || ASSET_TYPES[ASSET_TYPES.length - 1];
}

function Field({ id, label, children, hint }) {
  return (
    <div className="space-y-1">
      <label className="block text-sm text-slate-400" htmlFor={id}>{label}</label>
      {children}
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

const EMPTY_FORM = {
  name: '',
  asset_type: 'business',
  description: '',
  estimated_value: '',
  ownership_pct: '100',
  generates_income: false,
  monthly_income: '',
  income_description: '',
  expected_sale_age: '',
  expected_sale_value: '',
  notes: '',
};

function AssetModal({ asset, onClose, onSaved }) {
  const [form, setForm] = useState(
    asset
      ? {
          name: asset.name || '',
          asset_type: asset.asset_type || 'business',
          description: asset.description || '',
          estimated_value: asset.estimated_value != null ? String(Number(asset.estimated_value)) : '',
          ownership_pct: asset.ownership_pct != null ? String(Number(asset.ownership_pct)) : '100',
          generates_income: asset.generates_income === true,
          monthly_income: asset.monthly_income != null ? String(Number(asset.monthly_income)) : '',
          income_description: asset.income_description || '',
          expected_sale_age: asset.expected_sale_age != null ? String(asset.expected_sale_age) : '',
          expected_sale_value: asset.expected_sale_value != null ? String(Number(asset.expected_sale_value)) : '',
          notes: asset.notes || '',
        }
      : EMPTY_FORM
  );
  const [error, setError] = useState('');

  const set = (key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name,
        asset_type: form.asset_type,
        description: form.description || null,
        estimated_value: Number(form.estimated_value) || 0,
        ownership_pct: Number(form.ownership_pct) || 100,
        generates_income: form.generates_income,
        monthly_income: form.generates_income ? (Number(form.monthly_income) || 0) : 0,
        income_description: form.generates_income ? (form.income_description || null) : null,
        expected_sale_age: form.expected_sale_age === '' ? null : Number(form.expected_sale_age),
        expected_sale_value: form.expected_sale_value === '' ? null : Number(form.expected_sale_value),
        notes: form.notes || null,
      };
      return asset
        ? apiClient.put(`/other-assets/${asset.id}`, payload)
        : apiClient.post('/other-assets', payload);
    },
    onSuccess: () => onSaved(),
    onError: (err) => setError(err?.response?.data?.error || 'Failed to save asset'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-800 bg-slate-900 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-lg font-semibold">{asset ? 'Edit Asset' : 'Add Other Asset'}</h3>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field id="oa-name" label="Asset name">
            <Input id="oa-name" value={form.name} onChange={set('name')} placeholder="HyperSurf Internet Services" />
          </Field>
          <Field id="oa-type" label="Asset type">
            <select
              id="oa-type"
              value={form.asset_type}
              onChange={set('asset_type')}
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
            >
              {ASSET_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </Field>

          <div className="md:col-span-2">
            <Field id="oa-desc" label="Description (optional)">
              <Input id="oa-desc" value={form.description} onChange={set('description')} placeholder="Brief description" />
            </Field>
          </div>

          <Field id="oa-value" label="Estimated current value ($)">
            <Input id="oa-value" type="number" min="0" step="1000" value={form.estimated_value} onChange={set('estimated_value')} />
          </Field>
          <Field id="oa-pct" label="Your ownership %" hint="Enter your ownership percentage (default 100%)">
            <Input id="oa-pct" type="number" min="0" max="100" step="0.1" value={form.ownership_pct} onChange={set('ownership_pct')} />
          </Field>

          <div className="md:col-span-2">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={form.generates_income} onChange={set('generates_income')} />
              This asset generates income
            </label>
          </div>

          {form.generates_income ? (
            <>
              <Field id="oa-income" label="Monthly income ($)">
                <Input id="oa-income" type="number" min="0" step="100" value={form.monthly_income} onChange={set('monthly_income')} />
              </Field>
              <Field id="oa-income-desc" label="Income description (optional)">
                <Input id="oa-income-desc" value={form.income_description} onChange={set('income_description')} placeholder="Business salary/distributions" />
              </Field>
            </>
          ) : null}

          <Field id="oa-sale-age" label="Expected sale age (optional)">
            <Input id="oa-sale-age" type="number" min="30" max="100" value={form.expected_sale_age} onChange={set('expected_sale_age')} placeholder="67" />
          </Field>
          <Field
            id="oa-sale-val"
            label="Expected sale value (optional)"
            hint="Leave blank if same as current value"
          >
            <Input id="oa-sale-val" type="number" min="0" step="1000" value={form.expected_sale_value} onChange={set('expected_sale_value')} />
          </Field>

          <div className="md:col-span-2">
            <Field id="oa-notes" label="Notes (optional)">
              <Input id="oa-notes" value={form.notes} onChange={set('notes')} />
            </Field>
          </div>
        </div>

        {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}

        <div className="mt-6 flex justify-end gap-3">
          <Button className="bg-slate-700 hover:bg-slate-600" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !form.name.trim() || form.estimated_value === ''}
          >
            {saveMutation.isPending ? 'Saving…' : asset ? 'Save Changes' : 'Add Asset'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function AssetCard({ asset, onEdit, onArchive }) {
  const meta = typeMeta(asset.asset_type);
  const pct = Number(asset.ownership_pct ?? 100);

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/15 text-xl">
            {meta.emoji}
          </span>
          <div>
            <div className="text-lg font-semibold text-slate-100">{asset.name}</div>
            <div className="text-sm text-slate-400">
              {meta.label}{pct < 100 ? ` · ${pct}% ownership` : ' · 100% ownership'}
            </div>
          </div>
        </div>
        <Button className="bg-slate-700 px-3 py-1 text-xs hover:bg-slate-600" onClick={onEdit}>Edit</Button>
      </div>

      {asset.description ? <p className="mt-2 text-sm text-slate-500">{asset.description}</p> : null}

      <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-2 text-sm md:grid-cols-3">
        <div>
          <div className="text-slate-400">Estimated Value</div>
          <div className="font-medium text-slate-100">{formatCurrency(Number(asset.estimated_value))}</div>
        </div>
        {pct < 100 ? (
          <div>
            <div className="text-slate-400">Your Share ({pct}%)</div>
            <div className="font-medium text-slate-100">{formatCurrency(asset.yourShare)}</div>
          </div>
        ) : (
          <div>
            <div className="text-slate-400">Your Share</div>
            <div className="font-medium text-slate-100">{formatCurrency(asset.yourShare)}</div>
          </div>
        )}

        {asset.generates_income ? (
          <div>
            <div className="text-slate-400">Monthly Income</div>
            <div className="font-medium text-emerald-400">
              {formatCurrency(Number(asset.monthly_income))}/mo
              {asset.income_description ? (
                <span className="ml-1 text-xs text-slate-500">({asset.income_description})</span>
              ) : null}
            </div>
          </div>
        ) : (
          <div>
            <div className="text-slate-400">Income</div>
            <div className="text-sm text-slate-500">No income generated</div>
          </div>
        )}

        {asset.generates_income && asset.annual_income > 0 ? (
          <div>
            <div className="text-slate-400">Annual Income</div>
            <div className="font-medium text-slate-100">{formatCurrency(asset.annual_income)}</div>
          </div>
        ) : null}

        {asset.expected_sale_age != null ? (
          <div>
            <div className="text-slate-400">Expected Sale</div>
            <div className="font-medium text-slate-100">
              Age {asset.expected_sale_age}
              {asset.expected_sale_value != null ? ` · ${formatCurrency(Number(asset.expected_sale_value))}` : ''}
            </div>
          </div>
        ) : null}
      </div>

      {asset.notes ? <p className="mt-3 text-sm text-slate-500">{asset.notes}</p> : null}

      <div className="mt-4 flex gap-2 border-t border-slate-800 pt-3">
        <Button
          className="ml-auto bg-slate-800 px-3 py-1 text-xs text-slate-400 hover:bg-red-500/20 hover:text-red-300"
          onClick={onArchive}
        >
          Archive
        </Button>
      </div>
    </Card>
  );
}

function StatCard({ label, value, sub }) {
  return (
    <Card className="p-4">
      <div className="text-sm text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-100">{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-slate-500">{sub}</div> : null}
    </Card>
  );
}

function groupByType(assets) {
  const groups = {};
  for (const asset of assets) {
    if (!groups[asset.asset_type]) groups[asset.asset_type] = [];
    groups[asset.asset_type].push(asset);
  }
  return groups;
}

export default function OtherAssets() {
  const queryClient = useQueryClient();
  const [modal, setModal] = useState(null); // null | {mode:'add'} | {mode:'edit',asset}
  const [archiveTarget, setArchiveTarget] = useState(null);

  const summaryQuery = useQuery({
    queryKey: ['other-assets-summary'],
    queryFn: async () => (await apiClient.get('/other-assets/summary')).data,
  });

  const archiveMutation = useMutation({
    mutationFn: async (id) => apiClient.delete(`/other-assets/${id}`),
    onSuccess: () => {
      setArchiveTarget(null);
      queryClient.invalidateQueries({ queryKey: ['other-assets-summary'] });
      queryClient.invalidateQueries({ queryKey: ['net-worth'] });
    },
  });

  const refresh = () => {
    setModal(null);
    queryClient.invalidateQueries({ queryKey: ['other-assets-summary'] });
    queryClient.invalidateQueries({ queryKey: ['net-worth'] });
  };

  const data = summaryQuery.data;
  const assets = data?.assets || [];
  const activeAssets = assets.filter((a) => !a.archived_at);
  const grouped = groupByType(activeAssets);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">Other Assets</h2>
          <p className="mt-1 text-sm text-slate-400">Business interests, intellectual property, and other valuable assets</p>
        </div>
        <Button onClick={() => setModal({ mode: 'add' })}>
          <Briefcase size={16} className="mr-2" />
          + Add Asset
        </Button>
      </div>

      {data && activeAssets.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <StatCard label="Total Value" value={formatCurrency(data.totalValue)} />
          <StatCard label="Your Share" value={formatCurrency(data.yourShare)} />
          <StatCard
            label="Monthly Income"
            value={data.monthlyIncome > 0 ? `${formatCurrency(data.monthlyIncome)}/mo` : '—'}
            sub={data.monthlyIncome > 0 ? `${formatCurrency(data.annualIncome)}/yr` : null}
          />
        </div>
      ) : null}

      {summaryQuery.isLoading ? (
        <p className="py-12 text-center text-sm text-slate-400">Loading…</p>
      ) : activeAssets.length === 0 ? (
        <Card>
          <div className="py-12 text-center">
            <span className="text-4xl">💼</span>
            <p className="mt-4 text-slate-400">No other assets tracked yet.</p>
            <p className="mt-1 text-sm text-slate-500">
              Track business interests, intellectual property, and other valuable assets here.
            </p>
            <Button className="mt-4" onClick={() => setModal({ mode: 'add' })}>
              + Add Asset
            </Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([type, typeAssets]) => {
            const meta = typeMeta(type);
            return (
              <div key={type}>
                <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
                  {meta.emoji} {meta.label}{typeAssets.length > 1 ? 's' : ''}
                </h3>
                <div className="space-y-4">
                  {typeAssets.map((asset) => (
                    <AssetCard
                      key={asset.id}
                      asset={asset}
                      onEdit={() => setModal({ mode: 'edit', asset })}
                      onArchive={() => setArchiveTarget(asset)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modal?.mode === 'add' || modal?.mode === 'edit' ? (
        <AssetModal
          asset={modal.asset || null}
          onClose={() => setModal(null)}
          onSaved={refresh}
        />
      ) : null}

      {archiveTarget ? (
        <ConfirmDialog
          isOpen
          title="Archive asset?"
          message={`"${archiveTarget.name}" will be removed from your totals. You can still view it in your records.`}
          confirmLabel="Archive"
          onConfirm={() => archiveMutation.mutate(archiveTarget.id)}
          onCancel={() => setArchiveTarget(null)}
        />
      ) : null}
    </div>
  );
}
