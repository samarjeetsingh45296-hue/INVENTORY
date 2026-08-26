'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ErrorNote } from '@/components/ui';
import type { SyncSource } from './page';

interface Mapping {
  sourceHeader: string;
  targetField: string | null;
  transform: string;
  isRequired: boolean;
  isIgnored: boolean;
}

const TRANSFORMS = [
  'trim', 'upper', 'lower', 'title', 'date', 'number', 'boolean', 'phone', 'email', 'none',
];

const TARGET_FIELDS: Record<string, string[]> = {
  employee: [
    'employeeCode', 'firstName', 'lastName', 'officialEmail', 'personalEmail',
    'phone', 'alternatePhone', 'gender', 'bloodGroup', 'dateOfBirth',
    'dateOfJoining', 'dateOfLeaving', 'employmentStatus', 'employmentType',
    'process', 'shift', 'seatNumber', 'address', 'remarks',
  ],
  asset: [
    'assetTag', 'serialNumber', 'categoryCode', 'categoryName', 'make', 'model',
    'status', 'condition', 'purchaseDate', 'purchaseCost', 'warrantyEndsAt', 'notes',
  ],
};

/**
 * Maps spreadsheet columns onto database fields.
 *
 * This is what makes a renamed or reordered column a ten-second fix rather
 * than a code change, and why an import can never quietly write the wrong
 * column into the wrong field.
 */
export function MappingEditor({
  source,
  onClose,
}: {
  source: SyncSource;
  onClose: () => void;
}) {
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [entity, setEntity] = useState(source.targetEntity);

  const columns = useQuery({
    queryKey: ['sync', 'columns', source.id],
    queryFn: () => api<any>(`/sync/sources/${source.id}/columns`),
    retry: false,
  });

  const suggest = useMutation({
    mutationFn: () =>
      api<any>(`/sync/sources/${source.id}/mappings/suggest`, { method: 'POST' }),
    onSuccess: (data) => setMappings(data.suggestions),
  });

  const save = useMutation({
    mutationFn: async () => {
      await api(`/sync/sources/${source.id}`, {
        method: 'PATCH',
        body: { targetEntity: entity },
      });
      return api(`/sync/sources/${source.id}/mappings`, {
        method: 'POST',
        body: { mappings },
      });
    },
    onSuccess: onClose,
  });

  // Seed the editor from whatever is already saved.
  useEffect(() => {
    const existing = columns.data?.existingMappings ?? [];
    const headers: string[] = columns.data?.headers ?? [];
    if (!headers.length) return;

    setMappings(
      headers.map((h) => {
        const m = existing.find((e: any) => e.sourceHeader === h);
        return {
          sourceHeader: h,
          targetField: m?.targetField ?? null,
          transform: m?.transform ?? 'trim',
          isRequired: m?.isRequired ?? false,
          isIgnored: m?.isIgnored ?? !m,
        };
      }),
    );
  }, [columns.data]);

  const update = (index: number, patch: Partial<Mapping>) =>
    setMappings((prev) => prev.map((m, i) => (i === index ? { ...m, ...patch } : m)));

  const fields = TARGET_FIELDS[entity] ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto
                    bg-black/40 p-4">
      <div className="card w-full max-w-4xl p-5">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Map columns</h2>
            <p className="text-sm text-[rgb(var(--muted))]">{source.name}</p>
          </div>
          <button className="btn-ghost" onClick={onClose}>Close</button>
        </div>

        {columns.isError && (
          <div className="mb-4">
            <ErrorNote error={columns.error} />
            <p className="mt-2 text-sm text-[rgb(var(--muted))]">
              The sheet could not be read. Nothing has changed, and any data already
              imported from it is still available.
            </p>
          </div>
        )}

        {columns.isLoading && (
          <p className="text-sm text-[rgb(var(--muted))]">Reading the header row...</p>
        )}

        {columns.data && (
          <>
            <div className="mb-4 flex flex-wrap items-end gap-3">
              <label>
                <span className="label">These rows are</span>
                <select
                  className="input max-w-[14rem]"
                  value={entity}
                  onChange={(e) => setEntity(e.target.value)}
                >
                  <option value="employee">Employees</option>
                  <option value="asset">Assets / equipment</option>
                </select>
              </label>
              <button
                className="btn-ghost"
                onClick={() => suggest.mutate()}
                disabled={suggest.isPending}
              >
                {suggest.isPending ? 'Matching...' : 'Auto-match columns'}
              </button>
              <p className="text-sm text-[rgb(var(--muted))]">
                {columns.data.totalRows} data rows found
              </p>
            </div>

            <div className="max-h-[50vh] overflow-y-auto rounded-md border
                            border-[rgb(var(--border))]">
              <table className="w-full">
                <thead className="sticky top-0 bg-[rgb(var(--surface))]">
                  <tr>
                    <th className="th">Sheet column</th>
                    <th className="th">Sample value</th>
                    <th className="th">Database field</th>
                    <th className="th">Convert as</th>
                    <th className="th">Required</th>
                  </tr>
                </thead>
                <tbody>
                  {mappings.map((m, i) => (
                    <tr key={m.sourceHeader}>
                      <td className="td font-medium">{m.sourceHeader}</td>
                      <td className="td max-w-[12rem] truncate text-[rgb(var(--muted))]">
                        {String(columns.data.sampleRows?.[0]?.[m.sourceHeader] ?? '')}
                      </td>
                      <td className="td">
                        <select
                          className="input"
                          value={m.targetField ?? ''}
                          onChange={(e) =>
                            update(i, {
                              targetField: e.target.value || null,
                              isIgnored: !e.target.value,
                            })
                          }
                        >
                          <option value="">(ignore this column)</option>
                          {fields.map((fld) => (
                            <option key={fld} value={fld}>{fld}</option>
                          ))}
                        </select>
                      </td>
                      <td className="td">
                        <select
                          className="input"
                          value={m.transform}
                          disabled={!m.targetField}
                          onChange={(e) => update(i, { transform: e.target.value })}
                        >
                          {TRANSFORMS.map((t) => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                      </td>
                      <td className="td text-center">
                        <input
                          type="checkbox"
                          checked={m.isRequired}
                          disabled={!m.targetField}
                          onChange={(e) => update(i, { isRequired: e.target.checked })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {save.isError && (
              <div className="mt-3">
                <ErrorNote error={save.error} />
              </div>
            )}

            <div className="mt-4 flex items-center justify-between gap-4">
              <p className="text-xs text-[rgb(var(--muted))]">
                Marking a column required means the import stops with a clear message
                if that column ever disappears, instead of silently writing blanks.
              </p>
              <button
                className="btn-primary shrink-0"
                onClick={() => save.mutate()}
                disabled={save.isPending}
              >
                {save.isPending ? 'Saving...' : 'Save mapping'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
