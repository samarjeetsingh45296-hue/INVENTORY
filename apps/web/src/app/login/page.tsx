'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';

export default function LoginPage() {
  const { login, verifyMfa, enrolmentNotice } = useAuth();
  const router = useRouter();

  const [step, setStep] = useState<'credentials' | 'mfa' | 'enrol'>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (step === 'credentials') {
        const result = await login(email, password);
        if (result === 'MFA_REQUIRED') setStep('mfa');
        else if (result === 'MFA_ENROLMENT_REQUIRED') setStep('enrol');
        else router.push('/dashboard');
      } else if (step === 'mfa') {
        await verifyMfa(code);
        router.push('/dashboard');
      }
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not sign in. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden
                          bg-[rgb(var(--accent))] p-10 text-[rgb(var(--accent-fg))] lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              'linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)',
            backgroundSize: '44px 44px',
          }}
        />
        <div className="relative flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg
                          bg-[rgb(var(--accent-fg))] text-[13px] font-bold
                          text-[rgb(var(--accent))]">
            IS
          </div>
          <span className="text-[14px] font-semibold tracking-tight">Inventory Suite</span>
        </div>
        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">
            Every asset, every holder, one record.
          </h2>
          <p className="mt-3 text-[13px] leading-relaxed opacity-70">
            Laptops, CUG lines, lockers, workstations and repairs for the
            Central Contact Center - stored permanently, with a change history
            nobody can rewrite.
          </p>
        </div>
        <p className="eyebrow relative !text-current opacity-50">Parul University</p>
      </section>

      <section className="grid place-items-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-6">
            <div className="mb-5 grid h-10 w-10 place-items-center rounded-lg
                            bg-[rgb(var(--accent))] text-[13px] font-bold
                            text-[rgb(var(--accent-fg))] lg:hidden">
              IS
            </div>
            <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
            <p className="mt-1 text-[13px] text-[rgb(var(--muted))]">
              {process.env.NEXT_PUBLIC_APP_NAME ?? 'Inventory Suite'} - asset and inventory management
            </p>
          </div>

        <form onSubmit={onSubmit} className="card space-y-4 p-6">
          {step === 'enrol' ? (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold">Set up two-factor authentication</h2>
              <p className="text-sm text-[rgb(var(--muted))]">
                {enrolmentNotice ??
                  'Your role requires a second factor before you can sign in.'}
              </p>
              <p className="text-sm text-[rgb(var(--muted))]">
                The enrolment screen is not built yet. For now an administrator can
                complete this from the API, or clear MFA_REQUIRED_ROLES in the
                environment to sign in with a password alone.
              </p>
            </div>
          ) : step === 'credentials' ? (
            <>
              <div>
                <label className="label" htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  className="input"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div>
                <label className="label" htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  className="input"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </>
          ) : (
            <div>
              <label className="label" htmlFor="code">
                Authentication code
              </label>
              <input
                id="code"
                inputMode="numeric"
                className="input tracking-[0.4em] text-center text-lg"
                placeholder="000000"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <p className="mt-2 text-xs text-[rgb(var(--muted))]">
                Enter the 6-digit code from your authenticator app, or one of your
                recovery codes.
              </p>
            </div>
          )}

          {error && (
            <p
              role="alert"
              className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700
                         dark:bg-red-950 dark:text-red-300"
            >
              {error}
            </p>
          )}

          {step === 'enrol' ? (
            <button
              type="button"
              className="btn-ghost w-full"
              onClick={() => setStep('credentials')}
            >
              Back to sign in
            </button>
          ) : (
            <button type="submit" className="btn-primary btn-lg w-full" disabled={busy}>
              {busy ? 'Please wait...' : step === 'credentials' ? 'Sign in' : 'Verify'}
            </button>
          )}
        </form>
        </div>
      </section>
    </main>
  );
}
