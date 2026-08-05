import React from 'react';

import { cn } from '../../lib/utils';

export function Input({ className, ...props }) {
  return (
    <input
      className={cn(
        'w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100',
        'focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40',
        className
      )}
      {...props}
    />
  );
}
