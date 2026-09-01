'use client';

import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Eye, Pencil, UserCog, UserPlus } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Avatar, PageHeader, ErrorNote, TableSkeleton } from '@/components/ui';
import { PasswordInput } from '@/components/password-input';

interface Row {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  roles: string[];
}

const ROLE_OPTIONS = [
  { key: 'VIEWER', label: 'Viewer - can see everything, cannot change anything' },
  { key: 'ADMIN', label: 'Admin - full control of the website' },
];

export default function UsersPage() {
  const { user: me, can } = useAuth();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({ displayName: '', email: '', roleKey: 'VIEWER', password: '' });
  const [notice, setNotice] = useState<string | null>(null);
  const [pwFor, setPwFor] = useState<Row | null>(null);
  const [newPw, setNewPw] = useState('');

  const q = useQuery({ queryKey: ['users'], queryFn: () => api<Row[]>('/users') });

  const create = useMutation({
    mutationFn: () => api<{ message: string }>('/users', { method: 'POST', body: form }),
    onSuccess: (res) => {
      setNotice(res.message);
      setForm({ displayName: '', email: '', roleKey: 'VIEWER', password: '' });
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['users'] });

  const setActive = useMutation({
    mutationFn: (vars: { id: string; isActive: boolean }) =>
      api(`/users/${vars.id}/active`, { method: 'POST', body: { isActive: vars.isActive } }),
    onSuccess: refresh,
  });

  const setRole = useMutation({
    mutationFn: (vars: { id: string; roleKey: string }) =>
      api(`/users/${vars.id}/role`, { method: 'POST', body: { roleKey: vars.roleKey } }),
    onSuccess: refresh,
  });

  const resetPassword = useMutation({
    mutationFn: (vars: { id: string; password: string }) =>
      api<{ message: string }>(`/users/${vars.id}/password`, {
        method: 'POST', body: { password: vars.password },
      }),
    onSuccess: (res) => {
      setNotice(res.message);
      setPwFor(null);
      setNewPw('');
      refresh();
    },
  });

  const removeUser = useMutation({
    mutationFn: (id: string) => api(`/users/${id}/delete`, { method: 'POST' }),
    onSuccess: refresh,
  });

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const valid =
    form.displayName.trim() !== '' &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim()) &&
    form.password.length >= 6;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    create.mutate();
  };

  return (
    <>
      <PageHeader
        title="Users"
        description="Who can sign in, and what they are allowed to do. Viewers see everything and change nothing."
      />

      {can('user.create') && (
        <section className="card mb-3 p-4">
          <h2 className="mb-3 flex items-center gap-2 text-[13px] font-semibold">
            <UserPlus size={14} /> Add user
          </h2>
          <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
            <input
              className="input max-w-[13rem]"
              placeholder="Full name"
              value={form.displayName}
              onChange={(e) => set('displayName', e.target.value)}
            />
            <input
              className="input max-w-[16rem]"
              type="email"
              placeholder="email@paruluniversity.ac.in"
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
            />
            <select
              className="input max-w-[22rem]"
              value={form.roleKey}
              onChange={(e) => set('roleKey', e.target.value)}
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r.key} value={r.key}>{r.label}</option>
              ))}
            </select>
            <div className="w-full max-w-[13rem]">
              <PasswordInput
                placeholder="Password (min 6)"
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => set('password', e.target.value)}
              />
            </div>
            <button type="submit" className="btn-primary" disabled={!valid || create.isPending}>
              {create.isPending ? 'Adding...' : 'Add user'}
            </button>
          </form>
          <p className="hint mt-2">
            Share the email and password with the person yourself - the system does not
            send invitation mails. They should change the password after first sign-in.
          </p>
          {notice && (
            <p className="mt-2 rounded-md px-3 py-2 text-[12px]"
               style={{ background: 'rgb(var(--ok-bg))', color: 'rgb(var(--ok))' }}>
              {notice}
            </p>
          )}
          {create.isError && <div className="mt-2"><ErrorNote error={create.error} /></div>}
        </section>
      )}

      {(setActive.isError || setRole.isError || resetPassword.isError || removeUser.isError) && (
        <div className="mb-3">
          <ErrorNote
            error={setActive.error ?? setRole.error ?? resetPassword.error ?? removeUser.error}
          />
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="table" style={{ minWidth: '58rem' }}>
          <thead>
            <tr>
              <th className="th">User</th>
              <th className="th">Email</th>
              <th className="th">Role</th>
              <th className="th">Access</th>
              <th className="th">Last login</th>
              {can('user.update') && <th className="th text-right">Actions</th>}
            </tr>
          </thead>
          {q.isLoading ? <TableSkeleton rows={4} cols={6} /> : (
            <tbody>
              {(q.data ?? []).map((u) => {
                const isAdmin = u.roles.includes('ADMIN');
                const self = u.id === me?.userId;
                const other = isAdmin ? 'VIEWER' : 'ADMIN';
                return (
                  <tr key={u.id} className={u.isActive ? 'row' : 'row opacity-50'}>
                    <td className="td font-medium text-[rgb(var(--text))]">
                      <span className="inline-flex items-center gap-2">
                        <Avatar name={u.displayName} />
                        {u.displayName}
                        {self && <span className="badge-info">you</span>}
                        {!u.isActive && <span className="badge-bad">disabled</span>}
                      </span>
                    </td>
                    <td className="td">{u.email}</td>
                    <td className="td">
                      <span className={isAdmin ? 'badge-warn' : 'badge-ok'}>
                        {isAdmin ? 'Admin' : 'Viewer'}
                      </span>
                    </td>
                    <td className="td">
                      {/* What the role allows, at a glance: view / edit / manage users. */}
                      <span className="inline-flex gap-1">
                        <span className="btn-icon btn-ghost pointer-events-none" title="Can view every screen">
                          <Eye size={13} />
                        </span>
                        <span
                          className="btn-icon btn-ghost pointer-events-none"
                          title={isAdmin ? 'Can change anything' : 'Cannot change anything'}
                          style={isAdmin ? undefined : { opacity: 0.25 }}
                        >
                          <Pencil size={13} />
                        </span>
                        <span
                          className="btn-icon btn-ghost pointer-events-none"
                          title={isAdmin ? 'Can manage users' : 'Cannot manage users'}
                          style={isAdmin ? undefined : { opacity: 0.25 }}
                        >
                          <UserCog size={13} />
                        </span>
                      </span>
                    </td>
                    <td className="td whitespace-nowrap">
                      {u.lastLoginAt ? format(new Date(u.lastLoginAt), 'd MMM, hh:mm a') : 'never'}
                    </td>
                    {can('user.update') && (
                      <td className="td">
                        <div className="flex justify-end gap-1.5">
                          {!self && (
                            <button
                              className="btn-ghost"
                              disabled={setRole.isPending}
                              onClick={() => {
                                if (window.confirm(`Make ${u.displayName} ${other === 'ADMIN' ? 'an Admin (full control)' : 'a Viewer (read-only)'}?`)) {
                                  setRole.mutate({ id: u.id, roleKey: other });
                                }
                              }}
                            >
                              Role
                            </button>
                          )}
                          <button
                            className="btn-ghost"
                            disabled={resetPassword.isPending}
                            onClick={() => { setNewPw(''); setPwFor(u); }}
                          >
                            Password
                          </button>
                          {!self && (
                            <button
                              className="btn-ghost"
                              disabled={setActive.isPending}
                              onClick={() => {
                                const message = u.isActive
                                  ? `Disable ${u.displayName}? They are signed out immediately and cannot sign in until re-enabled.`
                                  : `Re-enable ${u.displayName}?`;
                                if (window.confirm(message)) {
                                  setActive.mutate({ id: u.id, isActive: !u.isActive });
                                }
                              }}
                            >
                              {u.isActive ? 'Disable' : 'Enable'}
                            </button>
                          )}
                          {!self && can('user.delete') && (
                            <button
                              className="btn-danger"
                              disabled={removeUser.isPending}
                              onClick={() => {
                                if (window.confirm(`Delete ${u.displayName}? The account disappears from this list and can never sign in. Their entries in the change history are kept.`)) {
                                  removeUser.mutate(u.id);
                                }
                              }}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          )}
        </table>
      </div>

      {pwFor && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
          onClick={() => setPwFor(null)}
        >
          <form
            className="card w-full max-w-xs space-y-3 p-5"
            style={{ boxShadow: 'var(--shadow-lg)' }}
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              if (newPw.length >= 6) resetPassword.mutate({ id: pwFor.id, password: newPw });
            }}
          >
            <div>
              <h3 className="text-sm font-semibold">Set a new password</h3>
              <p className="mt-1 text-[12px] text-[rgb(var(--muted))]">
                For {pwFor.displayName}. They are signed out everywhere and must use
                the new password.
              </p>
            </div>
            <PasswordInput
              autoFocus
              placeholder="New password (min 6)"
              autoComplete="new-password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
            />
            <div className="flex justify-end gap-1.5">
              <button type="button" className="btn-ghost" onClick={() => setPwFor(null)}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={newPw.length < 6 || resetPassword.isPending}
              >
                {resetPassword.isPending ? 'Saving...' : 'Set password'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
