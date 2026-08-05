import React from 'react';

import { cn } from '../../lib/utils';

export function Button({ className, type = 'button', ...props }) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors',
        'bg-sky-500 text-white hover:bg-sky-400 disabled:opacity-50',
        className
      )}
      {...props}
    />
  );
}
