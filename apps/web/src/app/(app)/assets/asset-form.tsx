'use client';

import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Modal, Field, ErrorNote } from '@/components/ui';

export interface AssetRow {
  id: string;
  assetTag: string;
  serialNumber: string | null;
  make: string | null;
  model: string | null;
  status: string;
  condition: string;
  notes?: string | null;
  categoryId?: string;
  category: { id?: string; name: string };
}

const STATUSES = [
  'IN_STOCK', 'ALLOCATED', 'IN_REPAIR', 'RESERVED', 'IN_TRANSIT',
  'LOST', 'STOLEN', 'SCRAPPED', 'RETIRED', 'DISPOSED',
];
const CONDITIONS = ['NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED', 'BEYOND_REPAIR', 'UNKNOWN'];

/** Create or edit an asset. `asset` null means create. */
export function AssetForm({
  asset, onClose,
}: { asset: AssetRow | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const editing = asset !== null;

  const [form, setForm] = useState({
    assetTag: asset?.assetTag ?? '',
    serialNumber: asset?.serialNumber ?? '',
    categoryId: asset?.categoryId ?? asset?.category?.id ?? '',
    make: asset?.make ?? '',
    model: asset?.model ?? '',
    status: asset?.status ?? 'IN_STOCK',
    condition: asset?.condition ?? 'GOOD',
    notes: asset?.notes ?? '',
  });

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<Array<{ id: string; name: string; code: string }>>('/assets/categories'),
  });

  const set = (k: keyof typeof form, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      // Blank strings would overwrite good values with empties on edit.
      const body: Record<string, unknown> = {
        assetTag: form.assetTag.trim(),
        serialNumber: form.serialNumber.trim() || null,
        categoryId: form.categoryId,
        make: form.make.trim() || null,
        model: form.model.trim() || null,
        status: form.status,
        condition: form.condition,
        notes: form.notes.trim() || null,
      };
      return editing
        ? api(`/assets/${asset.id}`, { method: 'PATCH', body })
        : api('/assets', { method: 'POST', body });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      onClose();
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  const valid = form.assetTag.trim() !== '' && form.categoryId !== '';

  return (
    <Modal
      title={editing ? `Edit ${asset.assetTag}` : 'Add asset'}
      description={
        editing
          ? 'Changes are written to the audit trail and the asset timeline.'
          : 'The asset is created immediately and starts its permanent history.'
      }
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button
            type="submit"
            form="asset-form"
            className="btn-primary"
            disabled={!valid || save.isPending}
          >
            {save.isPending ? 'Saving...' : editing ? 'Save changes' : 'Add asset'}
          </button>
        </>
      }
    >
      <form id="asset-form" onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
        <Field label="Asset tag" required hint="Printed on the sticker. Never reused.">
          <input
            className="input" required value={form.assetTag}
            onChange={(e) => set('assetTag', e.target.value)}
            placeholder="LPT-1001"
          />
        </Field>

        <Field label="Serial number">
          <input
            className="input" value={form.serialNumber}
            onChange={(e) => set('serialNumber', e.target.value)}
            placeholder="From the manufacturer"
          />
        </Field>

        <Field label="Category" required>
          <select
            className="input" required value={form.categoryId}
            onChange={(e) => set('categoryId', e.target.value)}
          >
            <option value="">Choose...</option>
            {(categories.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>

        <Field label="Make">
          <input
            className="input" value={form.make}
            onChange={(e) => set('make', e.target.value)}
            placeholder="Dell, HP, Logitech..."
          />
        </Field>

        <Field label="Model">
          <input
            className="input" value={form.model}
            onChange={(e) => set('model', e.target.value)}
          />
        </Field>

        <Field label="Status">
          <select className="input" value={form.status} onChange={(e) => set('status', e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s.replace(/_/g, ' ').toLowerCase()}</option>
            ))}
          </select>
        </Field>

        <Field label="Condition">
          <select className="input" value={form.condition} onChange={(e) => set('condition', e.target.value)}>
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>{c.replace(/_/g, ' ').toLowerCase()}</option>
            ))}
          </select>
        </Field>

        <div className="sm:col-span-2">
          <Field label="Notes">
            <textarea
              className="input" rows={2} value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
            />
          </Field>
        </div>

        {save.isError && (
          <div className="sm:col-span-2"><ErrorNote error={save.error} /></div>
        )}
      </form>
    </Modal>
  );
}
