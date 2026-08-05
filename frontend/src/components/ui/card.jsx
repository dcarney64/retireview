import React from 'react';

import { cn } from '../../lib/utils';

export const Card = React.forwardRef(function Card({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn('rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-lg shadow-black/20', className)}
      {...props}
    />
  );
});
