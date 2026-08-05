// Account types in fixed display order. Chart colors are assigned by type
// (identity), never by rank — the mapping below is validated for CVD
// separation and 3:1 contrast on the slate-900 card surface; keep the order
// and hexes together if you edit.
export const ACCOUNT_TYPES = [
  { value: 'brokerage', label: 'Brokerage', color: '#3987e5' },
  { value: 'composer', label: 'Composer', color: '#d95926' },
  { value: 'retirement', label: '401k / IRA', color: '#199e70' },
  { value: 'pension', label: 'Pension', color: '#c98500' },
  { value: 'real_estate', label: 'Real estate / home equity', color: '#d55181' },
  { value: 'cash', label: 'Bank / cash', color: '#008300' },
  { value: 'other', label: 'Other', color: '#9085e9' },
];

const byValue = Object.fromEntries(ACCOUNT_TYPES.map((t) => [t.value, t]));

export function typeLabel(value) {
  return byValue[value]?.label || value;
}

export function typeColor(value) {
  return byValue[value]?.color || '#9085e9';
}

export function formatCurrency(value, { compact = false } = {}) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
    ...(compact && { notation: 'compact', maximumFractionDigits: 1 }),
  }).format(Number(value) || 0);
}
