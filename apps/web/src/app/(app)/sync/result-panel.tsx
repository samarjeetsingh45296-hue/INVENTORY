'use client';

interface Props {
  result: any;
  onDismiss: () => void;
  onConfirm: (token: string) => void;
}

/**
 * Shows what a run did, or what a preview *would* do. The distinction matters:
 * a preview writes nothing, and the wording makes that unambiguous.
 */
export function ResultPanel({ result, onDismiss, onConfirm }: Props) {
  const isPreview = result.kind === 'preview';
  const needsConfirmation = result.status === 'AWAITING_CONFIRMATION';

  if (result.kind === 'disconnect') {
    return (
      <Panel onDismiss={onDismiss} tone="ok" title="Sheet disconnected">
        <p>{result.message}</p>
        <p className="mt-2">
          Still in the database: <strong>{result.retained?.employees ?? 0}</strong> employees
          and <strong>{result.retained?.assets ?? 0}</strong> assets.
        </p>
      </Panel>
    );
  }

  if (needsConfirmation) {
    return (
      <Panel onDismiss={onDismiss} tone="warn" title="Confirmation needed">
        <p>{result.message}</p>
        <button
          className="btn-primary mt-3"
          onClick={() => onConfirm(result.confirmationToken)}
        >
          I have reviewed this - import {result.rowsRead} rows
        </button>
      </Panel>
    );
  }

  const stats: Array<[string, number]> = [
    ['Rows read', result.rowsRead ?? 0],
    [isPreview ? 'Would create' : 'Created', result.rowsNew ?? 0],
    [isPreview ? 'Would update' : 'Updated', result.rowsUpdated ?? 0],
    ['Unchanged', result.rowsUnchanged ?? 0],
    ['Duplicates in sheet', result.rowsDuplicate ?? 0],
    ['Invalid rows', result.rowsInvalid ?? 0],
    ['Conflicts kept', result.rowsConflict ?? 0],
  ];

  return (
    <Panel
      onDismiss={onDismiss}
      tone={result.rowsInvalid || result.rowsConflict ? 'warn' : 'ok'}
      title={isPreview ? 'Preview - nothing was written' : 'Import finished'}
    >
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
        {stats.map(([label, value]) => (
          <div key={label}>
            <p className="text-xs text-[rgb(var(--muted))]">{label}</p>
            <p className="text-lg font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      {result.rowsConflict > 0 && (
        <p className="mt-3 text-sm">
          {result.rowsConflict} row(s) differ from the sheet but were edited more recently
          here, so the values entered in the website were kept. Open the run report to
          review them.
        </p>
      )}
      {result.rowsInvalid > 0 && (
        <p className="mt-1 text-sm">
          {result.rowsInvalid} row(s) could not be read. They were skipped; nothing else
          in the import was affected.
        </p>
      )}
      {result.preRunBackupId && (
        <p className="mt-2 text-xs text-[rgb(var(--muted))]">
          A full backup was taken before this migration.
        </p>
      )}
    </Panel>
  );
}

function Panel({
  title,
  tone,
  children,
  onDismiss,
}: {
  title: string;
  tone: 'ok' | 'warn';
  children: React.ReactNode;
  onDismiss: () => void;
}) {
  const toneClass =
    tone === 'ok'
      ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950'
      : 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950';

  return (
    <section className={`mb-4 rounded-md border p-4 ${toneClass}`}>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        <button className="text-sm underline" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
      <div className="text-sm">{children}</div>
    </section>
  );
}
