'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { api } from '@/lib/api';
import { Person } from '@/components/ui';

export interface PickedEmployee {
  id: string;
  fullName: string;
  employeeCode: string;
  level: string | null;
}

/**
 * Type a name or MIS code, pick the person from the list. The chosen person
 * shows with their level chip, the way names are written everywhere else.
 */
export function EmployeePicker({
  value, onChange, autoFocus, placeholder = 'Type a name or code...',
}: {
  value: PickedEmployee | null;
  onChange: (e: PickedEmployee | null) => void;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const [who, setWho] = useState('');
  const people = useQuery({
    queryKey: ['employees', 'pick', who],
    queryFn: () => api<{ items: PickedEmployee[] }>(`/employees?pageSize=8&search=${encodeURIComponent(who)}`),
    enabled: who.trim().length >= 2,
  });

  if (value) {
    return (
      <span className="input flex items-center justify-between gap-2" style={{ minWidth: '16rem' }}>
        <span className="truncate">
          <Person name={value.fullName} level={value.level} code={value.employeeCode} />
        </span>
        <button type="button" className="text-[rgb(var(--muted))]" title="Choose someone else"
                onClick={() => { onChange(null); setWho(''); }}>
          <X size={12} />
        </button>
      </span>
    );
  }

  return (
    <div className="relative" style={{ minWidth: '16rem' }}>
      <input className="input" placeholder={placeholder} value={who} autoFocus={autoFocus}
             onChange={(e) => setWho(e.target.value)} />
      {people.data && people.data.items.length > 0 && (
        <ul className="card absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto py-1 text-[13px]">
          {people.data.items.map((p) => (
            <li key={p.id}>
              <button type="button"
                      className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-[rgb(var(--surface-3))]"
                      onClick={() => onChange(p)}>
                <Person name={p.fullName} level={p.level} />
                <span className="font-mono text-[11px] text-[rgb(var(--muted))]">{p.employeeCode}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {who.trim().length >= 2 && people.data && people.data.items.length === 0 && (
        <p className="mt-1 text-[11px] text-[rgb(var(--muted))]">No one on record matches.</p>
      )}
    </div>
  );
}
