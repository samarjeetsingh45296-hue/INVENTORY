'use client';

import { clsx } from 'clsx';
import type { ReactNode } from 'react';

export function PageHeader({
  title, description, actions,
}: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[15px] font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-0.5 max-w-2xl text-[12px] leading-relaxed text-[rgb(var(--muted))]">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-1.5">{actions}</div>}
    </div>
  );
}

export function StatCard({
  label, value, hint, tone = 'default',
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'default' | 'ok' | 'warn' | 'bad';
}) {
  const accent = {
    default: 'text-[rgb(var(--text))]',
    ok: 'text-[rgb(var(--ok))]',
    warn: 'text-[rgb(var(--warn))]',
    bad: 'text-[rgb(var(--bad))]',
  }[tone];

  return (
    <div className="card px-3 py-2.5">
      <p className="text-[10px] font-medium uppercase tracking-wider text-[rgb(var(--muted))]">
        {label}
      </p>
      <p className={clsx('mt-0.5 text-xl font-semibold tabular-nums leading-tight', accent)}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-[rgb(var(--muted))]">{hint}</p>}
    </div>
  );
}

/** Maps a domain status onto one of four semantic tones. */
const TONE: Record<string, string> = {
  IN_STOCK: 'badge-info', ALLOCATED: 'badge-ok', IN_REPAIR: 'badge-warn',
  RESERVED: 'badge-info', IN_TRANSIT: 'badge-info',
  LOST: 'badge-bad', STOLEN: 'badge-bad', SCRAPPED: 'badge-bad',
  RETIRED: 'badge-mute', DISPOSED: 'badge-mute',
  ACTIVE: 'badge-ok', RESIGNED: 'badge-mute', TERMINATED: 'badge-bad',
  ON_LEAVE: 'badge-warn', ON_NOTICE: 'badge-warn', ABSCONDED: 'badge-bad',
  SUCCESS: 'badge-ok', PARTIAL: 'badge-warn', FAILED: 'badge-bad',
  RUNNING: 'badge-info', PENDING: 'badge-mute',
  CONFLICT: 'badge-warn', INVALID: 'badge-bad', IMPORTED: 'badge-ok',
  NEW: 'badge-ok', UPDATED: 'badge-info', UNCHANGED: 'badge-mute',
  DUPLICATE: 'badge-warn', SKIPPED: 'badge-mute',
  CREATE: 'badge-ok', UPDATE: 'badge-info', SOFT_DELETE: 'badge-warn',
  RESTORE: 'badge-ok', LOGIN: 'badge-mute', LOGIN_FAILED: 'badge-bad',
  ROLE_REVOKED: 'badge-warn', ROLE_ASSIGNED: 'badge-info',
  ALLOCATE: 'badge-ok', RETURN: 'badge-info', SYNC: 'badge-info',
  BACKUP: 'badge-mute', EXPORT: 'badge-warn', IMPORT: 'badge-info',
  DISCONNECTED: 'badge-mute',
  NEW_CONDITION: 'badge-ok', GOOD: 'badge-ok', FAIR: 'badge-warn',
  POOR: 'badge-warn', DAMAGED: 'badge-bad', BEYOND_REPAIR: 'badge-bad',
  UNKNOWN: 'badge-mute',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={TONE[status] ?? 'badge-mute'}>
      {status.replace(/_/g, ' ').toLowerCase()}
    </span>
  );
}

export function EmptyState({
  message, hint, action,
}: { message: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-12 text-center">
      <p className="text-[13px] font-medium">{message}</p>
      {hint && (
        <p className="max-w-md text-[12px] leading-relaxed text-[rgb(var(--muted))]">{hint}</p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : 'Something went wrong';
  return (
    <div
      role="alert"
      className="rounded-md border px-3 py-2 text-[12px]"
      style={{
        borderColor: 'rgb(var(--bad) / 0.4)',
        background: 'rgb(var(--bad-bg))',
        color: 'rgb(var(--bad))',
      }}
    >
      {message}
    </div>
  );
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <tbody>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r}>
          {Array.from({ length: cols }).map((__, c) => (
            <td key={c} className="td">
              <div className="shimmer h-3 rounded" style={{ width: `${45 + ((r + c) % 4) * 15}%` }} />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

/** Centred modal used by every create/edit form. */
export function Modal({
  title, description, onClose, children, footer, wide = false,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={clsx('card w-full shadow-xl', wide ? 'max-w-4xl' : 'max-w-lg')}>
        <div className="flex items-start justify-between gap-4 border-b border-[rgb(var(--border))] px-4 py-3">
          <div>
            <h2 className="text-[13px] font-semibold">{title}</h2>
            {description && (
              <p className="mt-0.5 text-[11px] text-[rgb(var(--muted))]">{description}</p>
            )}
          </div>
          <button className="btn-quiet btn-icon" onClick={onClose} aria-label="Close">x</button>
        </div>
        <div className="px-4 py-3">{children}</div>
        {footer && (
          <div className="flex justify-end gap-1.5 border-t border-[rgb(var(--border))] px-4 py-2.5">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function Field({
  label, hint, children, required,
}: { label: string; hint?: string; children: ReactNode; required?: boolean }) {
  return (
    <label className="block">
      <span className="label">
        {label}
        {required && <span className="text-[rgb(var(--bad))]"> *</span>}
      </span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}
