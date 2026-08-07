import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { useState } from 'react';

import apiClient from '../api/client';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { formatCurrency } from '../lib/accountTypes';

function Field({ id, label, children, hint }) {
  return (
    <div className="space-y-1">
      <label className="block text-sm text-slate-400" htmlFor={id}>{label}</label>
      {children}
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

function SelectField({ id, label, value, onChange, children }) {
  return (
    <Field id={id} label={label}>
      <select
        id={id}
        value={value}
        onChange={onChange}
        className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
      >
        {children}
      </select>
    </Field>
  );
}

const EMPTY_FORM = {
  name: '',
  relationship: 'spouse',
  birth_year: '',
  current_age: '',
  employment_status: 'employed',
  monthly_income: '',
  social_security_monthly: '',
  social_security_age: '67',
  pension_monthly: '',
  retirement_age: '67',
  estimated_assets: '',
  estimated_liabilities: '',
  include_in_combined: true,
  notes: '',
};

function MemberModal({ member, onClose, onSaved }) {
  const [form, setForm] = useState(
    member
      ? {
          name: member.name || '',
          relationship: member.relationship || 'spouse',
          birth_year: member.birth_year != null ? String(member.birth_year) : '',
          current_age: member.current_age != null ? String(member.current_age) : '',
          employment_status: member.employment_status || 'employed',
          monthly_income: member.monthly_income != null ? String(Number(member.monthly_income)) : '',
          social_security_monthly: member.social_security_monthly != null ? String(Number(member.social_security_monthly)) : '',
          social_security_age: member.social_security_age != null ? String(member.social_security_age) : '67',
          pension_monthly: member.pension_monthly != null ? String(Number(member.pension_monthly)) : '',
          retirement_age: member.retirement_age != null ? String(member.retirement_age) : '67',
          estimated_assets: member.estimated_assets != null ? String(Number(member.estimated_assets)) : '',
          estimated_liabilities: member.estimated_liabilities != null ? String(Number(member.estimated_liabilities)) : '',
          include_in_combined: member.include_in_combined !== false,
          notes: member.notes || '',
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
        relationship: form.relationship,
        birth_year: form.birth_year === '' ? null : Number(form.birth_year),
        current_age: form.current_age === '' ? null : Number(form.current_age),
        employment_status: form.employment_status,
        monthly_income: Number(form.monthly_income) || 0,
        social_security_monthly: Number(form.social_security_monthly) || 0,
        social_security_age: Number(form.social_security_age) || 67,
        pension_monthly: Number(form.pension_monthly) || 0,
        retirement_age: Number(form.retirement_age) || 67,
        estimated_assets: Number(form.estimated_assets) || 0,
        estimated_liabilities: Number(form.estimated_liabilities) || 0,
        include_in_combined: form.include_in_combined,
        notes: form.notes || null,
      };
      return member
        ? apiClient.put(`/household/${member.id}`, payload)
        : apiClient.post('/household', payload);
    },
    onSuccess: () => onSaved(),
    onError: (err) => setError(err?.response?.data?.error || 'Failed to save member'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-800 bg-slate-900 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-lg font-semibold">{member ? 'Edit Member' : 'Add Household Member'}</h3>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field id="hm-name" label="Name">
            <Input id="hm-name" value={form.name} onChange={set('name')} placeholder="Spouse's name" />
          </Field>
          <SelectField id="hm-rel" label="Relationship" value={form.relationship} onChange={set('relationship')}>
            <option value="spouse">Spouse</option>
            <option value="partner">Partner</option>
            <option value="dependent">Dependent</option>
            <option value="other">Other</option>
          </SelectField>

          <Field id="hm-birth-year" label="Birth year (optional)">
            <Input id="hm-birth-year" type="number" min="1930" max="2020" value={form.birth_year} onChange={set('birth_year')} placeholder="1966" />
          </Field>
          <Field id="hm-age" label="Current age (optional)">
            <Input id="hm-age" type="number" min="0" max="120" value={form.current_age} onChange={set('current_age')} placeholder="58" />
          </Field>

          <SelectField id="hm-emp" label="Employment status" value={form.employment_status} onChange={set('employment_status')}>
            <option value="employed">Employed</option>
            <option value="self_employed">Self-employed</option>
            <option value="retired">Retired</option>
            <option value="other">Other</option>
          </SelectField>
          <Field id="hm-income" label="Monthly income ($)">
            <Input id="hm-income" type="number" min="0" step="100" value={form.monthly_income} onChange={set('monthly_income')} placeholder="0" />
          </Field>

          <Field id="hm-ss" label="Social Security ($/mo at full retirement)">
            <Input id="hm-ss" type="number" min="0" step="100" value={form.social_security_monthly} onChange={set('social_security_monthly')} placeholder="0" />
          </Field>
          <Field id="hm-ss-age" label="SS claiming age">
            <Input id="hm-ss-age" type="number" min="62" max="75" value={form.social_security_age} onChange={set('social_security_age')} />
          </Field>

          <Field id="hm-pension" label="Pension ($/mo)">
            <Input id="hm-pension" type="number" min="0" step="100" value={form.pension_monthly} onChange={set('pension_monthly')} placeholder="0" />
          </Field>
          <Field id="hm-ret-age" label="Planned retirement age">
            <Input id="hm-ret-age" type="number" min="30" max="100" value={form.retirement_age} onChange={set('retirement_age')} />
          </Field>

          <Field id="hm-assets" label="Estimated total assets (optional)" hint="Rough figure — retirement accounts, savings, etc.">
            <Input id="hm-assets" type="number" min="0" step="1000" value={form.estimated_assets} onChange={set('estimated_assets')} placeholder="0" />
          </Field>
          <Field id="hm-liabilities" label="Estimated total liabilities (optional)">
            <Input id="hm-liabilities" type="number" min="0" step="1000" value={form.estimated_liabilities} onChange={set('estimated_liabilities')} placeholder="0" />
          </Field>

          <div className="md:col-span-2">
            <Field id="hm-notes" label="Notes (optional)">
              <Input id="hm-notes" value={form.notes} onChange={set('notes')} />
            </Field>
          </div>

          <div className="md:col-span-2">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={form.include_in_combined} onChange={set('include_in_combined')} />
              Include in combined household view
            </label>
          </div>
        </div>

        {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}

        <div className="mt-6 flex justify-end gap-3">
          <Button className="bg-slate-700 hover:bg-slate-600" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !form.name.trim()}
          >
            {saveMutation.isPending ? 'Saving…' : member ? 'Save Changes' : 'Add Member'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function RelBadge({ relationship }) {
  const labels = {
    spouse: 'Spouse',
    partner: 'Partner',
    dependent: 'Dependent',
    other: 'Other',
  };
  return (
    <span className="rounded-full border border-slate-700 px-2.5 py-0.5 text-xs text-slate-400">
      {labels[relationship] || relationship}
    </span>
  );
}

function EmpLabel({ status }) {
  const labels = {
    employed: 'Currently employed',
    self_employed: 'Self-employed',
    retired: 'Retired',
    other: 'Other',
  };
  return <span className="text-slate-500">{labels[status] || status}</span>;
}

function MemberCard({ member, onEdit, onRemove }) {
  const ss = Number(member.social_security_monthly);
  const pension = Number(member.pension_monthly);
  const income = Number(member.monthly_income);
  const assets = Number(member.estimated_assets);
  const liabilities = Number(member.estimated_liabilities);
  const age = member.current_age ?? (member.birth_year ? new Date().getFullYear() - member.birth_year : null);

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-500/15 text-sky-400 text-lg">
            👤
          </span>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold text-slate-100">{member.name}</span>
              <RelBadge relationship={member.relationship} />
            </div>
            {age != null ? (
              <div className="text-sm text-slate-400">
                Age {age} · <EmpLabel status={member.employment_status} />
              </div>
            ) : (
              <div className="text-sm"><EmpLabel status={member.employment_status} /></div>
            )}
          </div>
        </div>
        <Button className="bg-slate-700 px-3 py-1 text-xs hover:bg-slate-600" onClick={onEdit}>Edit</Button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-2 text-sm md:grid-cols-3">
        {income > 0 ? (
          <div>
            <div className="text-slate-400">Monthly Income</div>
            <div className="font-medium text-slate-100">{formatCurrency(income)}</div>
          </div>
        ) : null}
        <div>
          <div className="text-slate-400">Social Security</div>
          <div className="font-medium text-slate-100">
            {ss > 0 ? `${formatCurrency(ss)}/mo at ${member.social_security_age}` : '—'}
          </div>
        </div>
        <div>
          <div className="text-slate-400">Pension</div>
          <div className="font-medium text-slate-100">{pension > 0 ? `${formatCurrency(pension)}/mo` : '—'}</div>
        </div>
        {assets > 0 ? (
          <div>
            <div className="text-slate-400">Est. Assets</div>
            <div className="font-medium text-slate-100">{formatCurrency(assets)}</div>
          </div>
        ) : null}
        {liabilities > 0 ? (
          <div>
            <div className="text-slate-400">Est. Liabilities</div>
            <div className="font-medium text-slate-100">{formatCurrency(liabilities)}</div>
          </div>
        ) : null}
        <div>
          <div className="text-slate-400">Retirement Age</div>
          <div className="font-medium text-slate-100">{member.retirement_age}</div>
        </div>
      </div>

      {member.notes ? <p className="mt-3 text-sm text-slate-500">{member.notes}</p> : null}

      <div className="mt-4 flex gap-2 border-t border-slate-800 pt-3">
        {!member.include_in_combined ? (
          <span className="text-xs text-slate-500 italic">Not included in combined view</span>
        ) : null}
        <Button
          className="ml-auto bg-slate-800 px-3 py-1 text-xs text-slate-400 hover:bg-red-500/20 hover:text-red-300"
          onClick={onRemove}
        >
          Remove
        </Button>
      </div>
    </Card>
  );
}

function CombinedSummaryCard({ summary, members }) {
  const { combined } = summary;
  return (
    <Card className="border-sky-500/30">
      <div className="flex items-center gap-3">
        <span className="text-xl">🏠</span>
        <h3 className="text-lg font-semibold">Combined Household</h3>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 text-sm md:grid-cols-3">
        {combined.totalMonthlyIncome > 0 ? (
          <div>
            <div className="text-slate-400">Combined monthly income</div>
            <div className="text-xl font-semibold text-slate-100">{formatCurrency(combined.totalMonthlyIncome)}</div>
            <div className="text-xs text-slate-500">(member income)</div>
          </div>
        ) : null}
        {combined.memberAssets > 0 ? (
          <div>
            <div className="text-slate-400">Member estimated assets</div>
            <div className="text-xl font-semibold text-slate-100">{formatCurrency(combined.memberAssets)}</div>
          </div>
        ) : null}
        {combined.memberNetWorth !== 0 ? (
          <div>
            <div className="text-slate-400">Member net worth</div>
            <div className={`text-xl font-semibold ${combined.memberNetWorth >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {formatCurrency(combined.memberNetWorth)}
            </div>
          </div>
        ) : null}
      </div>

      {combined.retirementIncome.totalMonthly > 0 ? (
        <div className="mt-4 border-t border-slate-800 pt-4">
          <div className="mb-2 text-sm font-medium text-slate-300">Retirement income (combined)</div>
          <div className="space-y-1 text-sm">
            {combined.retirementIncome.members.map((m) => (
              <div key={m.name}>
                {m.ss > 0 ? (
                  <div className="flex justify-between">
                    <span className="text-slate-400">{m.name} SS (at {m.ssAge})</span>
                    <span className="text-slate-100">{formatCurrency(m.ss)}/mo</span>
                  </div>
                ) : null}
                {m.pension > 0 ? (
                  <div className="flex justify-between">
                    <span className="text-slate-400">{m.name} pension</span>
                    <span className="text-slate-100">{formatCurrency(m.pension)}/mo</span>
                  </div>
                ) : null}
              </div>
            ))}
            <div className="flex justify-between border-t border-slate-800 pt-1 font-medium">
              <span className="text-slate-300">Total monthly</span>
              <span className="text-slate-100">{formatCurrency(combined.retirementIncome.totalMonthly)}/mo</span>
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

export default function Household() {
  const queryClient = useQueryClient();
  const [modal, setModal] = useState(null); // null | {mode:'add'} | {mode:'edit',member}
  const [removeTarget, setRemoveTarget] = useState(null);

  const membersQuery = useQuery({
    queryKey: ['household'],
    queryFn: async () => (await apiClient.get('/household')).data,
  });
  const summaryQuery = useQuery({
    queryKey: ['household-summary'],
    queryFn: async () => (await apiClient.get('/household/summary')).data,
    enabled: (membersQuery.data?.length ?? 0) > 0,
  });

  const removeMutation = useMutation({
    mutationFn: async (id) => apiClient.delete(`/household/${id}`),
    onSuccess: () => {
      setRemoveTarget(null);
      queryClient.invalidateQueries({ queryKey: ['household'] });
      queryClient.invalidateQueries({ queryKey: ['household-summary'] });
      queryClient.invalidateQueries({ queryKey: ['net-worth'] });
    },
  });

  const refresh = () => {
    setModal(null);
    queryClient.invalidateQueries({ queryKey: ['household'] });
    queryClient.invalidateQueries({ queryKey: ['household-summary'] });
    queryClient.invalidateQueries({ queryKey: ['net-worth'] });
  };

  const members = membersQuery.data || [];
  const summary = summaryQuery.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">Household Members</h2>
          <p className="mt-1 text-sm text-slate-400">Track your household's combined financial picture</p>
        </div>
        <Button onClick={() => setModal({ mode: 'add' })}>
          <Users size={16} className="mr-2" />
          + Add Household Member
        </Button>
      </div>

      {membersQuery.isLoading ? (
        <p className="py-12 text-center text-sm text-slate-400">Loading…</p>
      ) : members.length === 0 ? (
        <Card>
          <div className="py-12 text-center">
            <span className="text-4xl">👥</span>
            <p className="mt-4 text-slate-400">No household members added yet.</p>
            <p className="mt-1 text-sm text-slate-500">
              Add your spouse, partner, or dependents to see your combined financial picture.
            </p>
            <Button className="mt-4" onClick={() => setModal({ mode: 'add' })}>
              + Add Household Member
            </Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {members.map((member) => (
            <MemberCard
              key={member.id}
              member={member}
              onEdit={() => setModal({ mode: 'edit', member })}
              onRemove={() => setRemoveTarget(member)}
            />
          ))}

          {summary ? <CombinedSummaryCard summary={summary} members={members} /> : null}
        </div>
      )}

      {modal?.mode === 'add' || modal?.mode === 'edit' ? (
        <MemberModal
          member={modal.member || null}
          onClose={() => setModal(null)}
          onSaved={refresh}
        />
      ) : null}

      {removeTarget ? (
        <ConfirmDialog
          isOpen
          title="Remove household member?"
          message={`"${removeTarget.name}" will be removed from your household. This cannot be undone.`}
          confirmLabel="Remove"
          onConfirm={() => removeMutation.mutate(removeTarget.id)}
          onCancel={() => setRemoveTarget(null)}
        />
      ) : null}
    </div>
  );
}
