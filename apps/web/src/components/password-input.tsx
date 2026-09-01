'use client';

import { forwardRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>;

/**
 * The one password box used everywhere: an `.input` with an eye button that
 * reveals what was typed. The button is out of the tab order so tabbing goes
 * straight from the field to the next control.
 */
export const PasswordInput = forwardRef<HTMLInputElement, Props>(
  function PasswordInput({ className = '', ...props }, ref) {
    const [show, setShow] = useState(false);
    return (
      <div className="relative">
        <input
          ref={ref}
          {...props}
          type={show ? 'text' : 'password'}
          className={`input pr-9 ${className}`}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setShow((s) => !s)}
          aria-label={show ? 'Hide password' : 'Show password'}
          title={show ? 'Hide password' : 'Show password'}
          className="absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2
                     place-items-center rounded text-[rgb(var(--muted))]
                     hover:bg-[rgb(var(--surface-3))] hover:text-[rgb(var(--text))]"
        >
          {show ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
        </button>
      </div>
    );
  },
);
