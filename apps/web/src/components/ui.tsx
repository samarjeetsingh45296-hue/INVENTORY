'use client';

import { clsx } from 'clsx';
import type { ReactNode } from 'react';

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {description && (
          <p className="mt-1 max-w-2xl text-sm text-[rgb(var(--muted))]">{description}</p>
        )}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-wide text-[rgb(var(--muted))]">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-[rgb(var(--muted))]">{hint}</p>}
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  IN_STOCK: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  ALLOCATED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  IN_REPAIR: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  RETIRED: 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  LOST: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  SUCCESS: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  PARTIAL: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  FAILED: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  RUNNING: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  CONFLICT: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  INVALID: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  IMPORTED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={clsx(
        'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
        STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
      )}
    >
      {status.replace(/_/g, ' ').toLowerCase()}
    </span>
  );
}

export function EmptyState({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="card p-10 text-center">
      <p className="text-sm font-medium">{message}</p>
      {hint && <p className="mt-1 text-sm text-[rgb(var(--muted))]">{hint}</p>}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : 'Something went wrong';
  return (
    <div
      role="alert"
      className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm
                 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
    >
      {message}
    </div>
  );
}
