'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Boxes, ScrollText, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { LogoCube } from '@/components/logo-cube';
import { PasswordInput } from '@/components/password-input';

const POINTS = [
  { icon: Boxes, text: 'Laptops, CUG lines, lockers, workstations and repairs in one place' },
  { icon: ScrollText, text: 'Every change is recorded - a history nobody can rewrite' },
  { icon: ShieldCheck, text: 'Admins manage, viewers see - nothing changes by accident' },
];

export default function LoginPage() {
  const { user, loading, login, verifyMfa, enrolmentNotice } = useAuth();
  const router = useRouter();

  // Already signed in? The sign-in page has nothing to offer - go to work.
  useEffect(() => {
    if (!loading && user) router.replace('/dashboard');
  }, [loading, user, router]);

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
      {/* Brand panel */}
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
        {/* Soft glow behind the cube */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-[38%] h-[26rem] w-[26rem]
                     -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.08]"
          style={{ background: 'radial-gradient(circle, currentColor, transparent 65%)' }}
        />

        <div className="relative flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg
                          bg-[rgb(var(--accent-fg))] text-[13px] font-bold
                          text-[rgb(var(--accent))]">
            IS
          </div>
          <span className="text-[14px] font-semibold tracking-tight">Inventory Suite</span>
        </div>

        <div className="relative flex flex-col items-center">
          <LogoCube size={132} />
          <div className="mt-10 max-w-md text-center">
            <h2 className="text-3xl font-semibold leading-tight tracking-tight">
              Every asset, every holder, one record.
            </h2>
          </div>
          <ul className="mt-8 max-w-md space-y-3">
            {POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3 text-[13px] leading-relaxed opacity-75">
                <span
                  className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md"
                  style={{
                    border: '1px solid color-mix(in srgb, currentColor 30%, transparent)',
                    background: 'color-mix(in srgb, currentColor 10%, transparent)',
                  }}
                >
                  <Icon size={13} aria-hidden />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <p className="eyebrow relative !text-current text-center opacity-50">
          Central Contact Center - Parul University
        </p>
      </section>

      {/* Sign-in panel */}
      <section className="grid place-items-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex flex-col items-center text-center">
            <div className="lg:hidden">
              <LogoCube size={72} />
            </div>
            <h1 className="mt-2 text-xl font-semibold tracking-tight">Welcome back</h1>
            <p className="mt-1 text-[13px] text-[rgb(var(--muted))]">
              Sign in to {process.env.NEXT_PUBLIC_APP_NAME ?? 'Inventory Suite'}
            </p>
          </div>

          <form onSubmit={onSubmit} className="card space-y-4 p-6"
                style={{ boxShadow: 'var(--shadow-lg)' }}>
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
                    placeholder="you@paruluniversity.ac.in"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="password">Password</label>
                  <PasswordInput
                    id="password"
                    autoComplete="current-password"
                    placeholder="Your password"
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

          <p className="mt-5 text-center text-[11px] text-[rgb(var(--muted))]">
            Access is created by an administrator. No account? Ask your admin.
          </p>
        </div>
      </section>
    </main>
  );
}
