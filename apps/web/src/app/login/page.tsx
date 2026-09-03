'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { PasswordInput } from '@/components/password-input';

type Step = 'credentials' | 'mfa' | 'enrol';

// The sign-in page carries the product name the user chose for it; the
// env app name still drives the tab title and the rest of the app.
const APP = 'Inventory Manager';

/** One item in the entrance stagger. Delay is in seconds. */
function Rise({ d, className = '', children }: { d: number; className?: string; children: ReactNode }) {
  return (
    <div className={`si-in ${className}`} style={{ '--d': `${d}s` } as React.CSSProperties}>
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------
   Right panel: the CRT on its hill. Pure CSS, a few embers for life.
------------------------------------------------------------------------- */
function Scene() {
  const embers = [
    { l: '22%', dur: 9, delay: -2, sx: 18 }, { l: '35%', dur: 12, delay: -7, sx: -12 },
    { l: '48%', dur: 10, delay: -4, sx: 8 }, { l: '61%', dur: 13, delay: -9, sx: -20 },
    { l: '72%', dur: 11, delay: -1, sx: 14 }, { l: '82%', dur: 14, delay: -6, sx: -8 },
    { l: '30%', dur: 15, delay: -11, sx: 22 }, { l: '66%', dur: 9.5, delay: -3, sx: -16 },
  ];
  return (
    <section className="si-scene hidden lg:block" aria-hidden>
      <div className="si-haze" />
      <div className="si-sun" />
      <div className="si-hill" />
      <div className="si-grass" />
      {embers.map((e, i) => (
        <span
          key={i}
          className="si-ember"
          style={{
            left: e.l,
            animationDuration: `${e.dur}s`,
            animationDelay: `${e.delay}s`,
            '--sx': `${e.sx}px`,
          } as React.CSSProperties}
        />
      ))}

      <div className="si-crt-wrap">
        <div className="si-crt">
          <div className="si-crt-body">
            <div className="si-crt-screen">
              <div className="si-crt-text">
                {APP}
                <small>CENTRAL CONTACT CENTER</small>
              </div>
            </div>
            <div className="si-crt-chin">
              <span className="si-crt-slot" />
              <span className="si-crt-led" />
            </div>
          </div>
          <div className="si-crt-neck" />
          <div className="si-crt-base" />
        </div>
        <div className="si-crt-shadow" />
      </div>

      <div className="si-vignette" />
    </section>
  );
}

/* -------------------------------------------------------------------------
   The page.
------------------------------------------------------------------------- */
export default function LoginPage() {
  const { login, verifyMfa, enrolmentNotice } = useAuth();
  const router = useRouter();

  const [step, setStep] = useState<Step>('credentials');
  const [leaving, setLeaving] = useState(false);
  // The cascade is armed one frame after mount rather than on first paint,
  // so it always plays in front of the user instead of finishing while the
  // page is still loading in.
  const [play, setPlay] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setPlay(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Fade the current stack out, swap, and let the next one rise in. */
  const go = (next: Step) => {
    setLeaving(true);
    window.setTimeout(() => {
      setError(null);
      setStep(next);
      setLeaving(false);
    }, 260);
  };

  // Mount-time safety: nothing should be stuck invisible if a transition is
  // interrupted by unmount.
  useEffect(() => () => setLeaving(false), []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (step === 'credentials') {
        const result = await login(email, password);
        if (result === 'MFA_REQUIRED') go('mfa');
        else if (result === 'MFA_ENROLMENT_REQUIRED') go('enrol');
        else router.push('/dashboard');
      } else if (step === 'mfa') {
        await verifyMfa(code);
        router.push('/dashboard');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={`si-page grid min-h-screen lg:grid-cols-2 ${play ? 'si-play' : ''}`}>
      {/* ------------------------------------------------------ left: form */}
      <section className="flex min-h-screen flex-col px-6 py-8 sm:px-12 sm:py-10">
        <Rise d={0}>
          <div className="si-brand">{APP}<span>.</span></div>
        </Rise>

        <div className="flex flex-1 items-center justify-center py-10">
          {/* Keyed on step so each stack replays its stagger from the top. */}
          <div key={step} className="si-stack w-full max-w-[440px]" data-leaving={leaving}>
            {step === 'credentials' && (
              <>
                <Rise d={0}>
                  <h1 className="mb-2 text-3xl font-bold tracking-tight">Sign in</h1>
                  <p className="text-[14px] leading-relaxed text-[#8e8e93]">
                    Sign in to your {APP} account and keep every asset, every
                    holder, and every record in one place.
                  </p>
                </Rise>

                <form onSubmit={onSubmit} className="mt-8 space-y-3.5">
                  <Rise d={0.06}>
                    <input
                      id="email"
                      type="email"
                      className="input"
                      placeholder="Enter Email"
                      autoComplete="username"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </Rise>
                  <Rise d={0.12}>
                    <PasswordInput
                      id="password"
                      placeholder="Enter Password"
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </Rise>
                  <Rise d={0.18} className="pt-2">
                    <button type="submit" className="si-cta" disabled={busy}>
                      <span className="si-shine" aria-hidden />
                      <span>{busy ? 'Signing in...' : 'Sign in'}</span>
                    </button>
                  </Rise>

                  {error && (
                    <div className="si-in" style={{ '--d': '0s' } as React.CSSProperties}>
                      <p role="alert" className="si-error">{error}</p>
                    </div>
                  )}
                </form>
              </>
            )}

            {step === 'mfa' && (
              <form onSubmit={onSubmit} className="space-y-3.5">
                <Rise d={0}>
                  <h1 className="mb-2 text-3xl font-bold tracking-tight">Verify it&apos;s you</h1>
                  <p className="text-[14px] leading-relaxed text-[#8e8e93]">
                    Enter the 6-digit code from your authenticator app, or one of your
                    recovery codes.
                  </p>
                </Rise>
                <Rise d={0.06} className="pt-4">
                  <input
                    id="code"
                    inputMode="numeric"
                    className="input text-center text-lg tracking-[0.4em]"
                    placeholder="000000"
                    autoComplete="one-time-code"
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </Rise>
                <Rise d={0.12} className="pt-2">
                  <button type="submit" className="si-cta" disabled={busy}>
                    {busy ? 'Verifying...' : 'Verify'}
                  </button>
                </Rise>
                {error && (
                  <div className="si-in" style={{ '--d': '0s' } as React.CSSProperties}>
                    <p role="alert" className="si-error">{error}</p>
                  </div>
                )}
                <Rise d={0.18} className="pt-2">
                  <p className="text-center text-[13.5px] text-[#8e8e93]">
                    Wrong account?{' '}
                    <button type="button" className="si-link" onClick={() => go('credentials')}>Back to sign in</button>
                  </p>
                </Rise>
              </form>
            )}

            {step === 'enrol' && (
              <div className="space-y-3.5">
                <Rise d={0}>
                  <h1 className="mb-2 text-3xl font-bold tracking-tight">Set up two-factor</h1>
                  <p className="text-[14px] leading-relaxed text-[#8e8e93]">
                    {enrolmentNotice ?? 'Your role requires a second factor before you can sign in.'}
                  </p>
                </Rise>
                <Rise d={0.06}>
                  <p className="si-note">
                    The enrolment screen is not built yet. For now an administrator can
                    complete this from the API, or clear MFA_REQUIRED_ROLES in the
                    environment to sign in with a password alone.
                  </p>
                </Rise>
                <Rise d={0.12} className="pt-2">
                  <button type="button" className="si-cta" onClick={() => go('credentials')}>
                    Back to sign in
                  </button>
                </Rise>
              </div>
            )}
          </div>
        </div>

        <Rise d={0.42}>
          <p className="text-center text-[11px] uppercase tracking-[0.22em] text-[#5c5c60]">
            Central Contact Center - Parul University
          </p>
        </Rise>
      </section>

      {/* ------------------------------------------------ right: the scene */}
      <Scene />
    </main>
  );
}
