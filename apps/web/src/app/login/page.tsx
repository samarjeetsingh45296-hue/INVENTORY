'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { PasswordInput } from '@/components/password-input';
import s from './login.module.css';

/** Ember specks drifting up the scene; fixed positions so render is stable. */
const MOTES = [
  { left: '18%', bottom: '22%', delay: '0s' },
  { left: '30%', bottom: '15%', delay: '2.2s' },
  { left: '55%', bottom: '18%', delay: '4.8s' },
  { left: '68%', bottom: '26%', delay: '1.4s' },
  { left: '80%', bottom: '14%', delay: '3.5s' },
  { left: '42%', bottom: '30%', delay: '6.1s' },
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

  // Staggered entrance: each block rises a beat after the previous one.
  const rise = (i: number) => ({
    className: s.rise,
    style: { animationDelay: `${0.08 * i + 0.05}s` },
  });

  return (
    // The page is deliberately dark whatever the app theme - the scene only
    // works on black - so it opts its whole subtree into the dark tokens.
    <div className={`dark ${s.stage}`}>
      <main className={s.frame}>
        <section className={s.panel}>
          <div className={`${s.brand} ${s.rise}`} style={{ animationDelay: '0.05s' }}>
            <span className={s.brandMark}>IS</span>
            Inventory Suite
          </div>

          <div className={s.formCol}>
            <form onSubmit={onSubmit} className="space-y-4">
              <div {...rise(1)}>
                <h1 className={s.title}>
                  {step === 'mfa' ? 'Two-factor check' : 'Sign in'}
                </h1>
                <p className={s.subtitle}>
                  {step === 'mfa'
                    ? 'Enter the 6-digit code from your authenticator app.'
                    : 'Every asset, every holder, one record - for the Central Contact Center.'}
                </p>
              </div>

              {step === 'enrol' ? (
                <div {...rise(2)}>
                  <p className={s.subtitle}>
                    {enrolmentNotice ??
                      'Your role requires a second factor before you can sign in.'}
                  </p>
                  <p className={`mt-2 ${s.subtitle}`}>
                    The enrolment screen is not built yet. For now an administrator
                    can complete this from the API, or clear MFA_REQUIRED_ROLES in
                    the environment to sign in with a password alone.
                  </p>
                </div>
              ) : step === 'credentials' ? (
                <>
                  <div {...rise(2)}>
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
                  <div {...rise(3)}>
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
                <div {...rise(2)}>
                  <label className="label" htmlFor="code">Authentication code</label>
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
                </div>
              )}

              {error && (
                <p
                  role="alert"
                  className="rounded-md bg-red-950 px-3 py-2 text-sm text-red-300"
                >
                  {error}
                </p>
              )}

              {step === 'enrol' ? (
                <button
                  type="button"
                  className={s.cta}
                  onClick={() => setStep('credentials')}
                >
                  Back to sign in
                </button>
              ) : (
                <div {...rise(4)}>
                  <button type="submit" className={s.cta} disabled={busy}>
                    {busy ? 'Please wait...' : step === 'credentials' ? 'Sign in' : 'Verify'}
                  </button>
                </div>
              )}
            </form>

            <p className={`${s.footNote} ${s.rise}`} style={{ animationDelay: '0.5s' }}>
              No account? <span className={s.ember}>Ask your administrator.</span>
            </p>
          </div>

          <p className={`eyebrow ${s.rise}`}
             style={{ animationDelay: '0.6s', color: '#8a8078' }}>
            Central Contact Center - Parul University
          </p>
        </section>

        <section className={s.scene} aria-hidden>
          <div className={s.glow} />
          <div className={s.hillFar} />
          <div className={s.hillNear} />
          <div className={s.grass} />
          {MOTES.map((m, i) => (
            <span key={i} className={s.mote}
                  style={{ left: m.left, bottom: m.bottom, animationDelay: m.delay }} />
          ))}
          <div className={s.tvWrap}>
            <div className={s.tv}>
              <div className={s.tvSide} />
              <div className={s.tvBody}>
                <div className={s.tvScreen}>
                  <span className={s.tvLogo}>
                    IS<small>uite</small>
                  </span>
                </div>
                <div className={s.tvSlot} />
              </div>
              <div className={s.tvShadow} />
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
