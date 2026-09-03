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

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.7-2 5-4.4 6.6v5.5h7.1c4.2-3.8 6.6-9.5 6.6-16.1z" />
      <path fill="#34A853" d="M24 46c6 0 11-2 14.6-5.4l-7.1-5.5c-2 1.3-4.5 2.1-7.5 2.1-5.8 0-10.7-3.9-12.4-9.1H4.3v5.7C7.9 41.1 15.4 46 24 46z" />
      <path fill="#FBBC05" d="M11.6 28.1c-.4-1.3-.7-2.7-.7-4.1s.2-2.8.7-4.1v-5.7H4.3C2.8 17.1 2 20.4 2 24s.8 6.9 2.3 9.8l7.3-5.7z" />
      <path fill="#EA4335" d="M24 10.8c3.3 0 6.2 1.1 8.5 3.3l6.3-6.3C35 4.3 30 2 24 2 15.4 2 7.9 6.9 4.3 14.2l7.3 5.7c1.7-5.2 6.6-9.1 12.4-9.1z" />
    </svg>
  );
}

function AppleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
    </svg>
  );
}

function XMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
    </svg>
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
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [agree, setAgree] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Fade the current stack out, swap, and let the next one rise in. */
  const go = (next: Step) => {
    setLeaving(true);
    window.setTimeout(() => {
      setError(null);
      setNotice(null);
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
    setNotice(null);
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

  const social = (name: string) =>
    setNotice(`${name} sign-in is not connected yet. Use your email and password, or ask your administrator to enable it.`);

  return (
    <main className="si-page grid min-h-screen lg:grid-cols-2">
      {/* ------------------------------------------------------ left: form */}
      <section className="flex min-h-screen flex-col px-6 py-8 sm:px-12 sm:py-10">
        <Rise d={0}>
          <div className="si-brand">{APP}<span>.</span></div>
        </Rise>

        <div className="flex flex-1 items-center py-10">
          {/* Keyed on step so each stack replays its stagger from the top. */}
          <div key={step} className="si-stack w-full max-w-[400px]" data-leaving={leaving}>
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
                  <Rise d={0.18} className="pt-1">
                    <label className="si-check relative">
                      <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                      <span className="si-box">
                        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
                          <path d="M2 6.5 4.6 9 10 3.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                      I agree to the Terms &amp; Privacy Policy
                    </label>
                  </Rise>
                  <Rise d={0.24} className="pt-2">
                    <button type="submit" className="si-cta" disabled={busy || !agree}>
                      {busy ? 'Signing in...' : 'Sign in'}
                    </button>
                  </Rise>

                  {(notice || error) && (
                    <div className="si-in" style={{ '--d': '0s' } as React.CSSProperties}>
                      {error && <p role="alert" className="si-error">{error}</p>}
                      {notice && <p className="si-note">{notice}</p>}
                    </div>
                  )}
                </form>

                <Rise d={0.3} className="mt-7">
                  <div className="si-divider">or sign in via</div>
                  <div className="mt-4 grid grid-cols-3 gap-3">
                    <button type="button" className="si-social" onClick={() => social('Google')} aria-label="Continue with Google">
                      <GoogleMark />
                    </button>
                    <button type="button" className="si-social" onClick={() => social('Apple')} aria-label="Continue with Apple">
                      <AppleMark />
                    </button>
                    <button type="button" className="si-social" onClick={() => social('X')} aria-label="Continue with X">
                      <XMark />
                    </button>
                  </div>
                </Rise>

                <Rise d={0.36} className="mt-8">
                  <p className="text-center text-[13.5px] text-[#8e8e93]">
                    Don&apos;t have an account?{' '}
                    <span className="si-link">Ask your administrator</span>
                  </p>
                </Rise>
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
          <p className="text-[11px] uppercase tracking-[0.22em] text-[#5c5c60]">
            Central Contact Center - Parul University
          </p>
        </Rise>
      </section>

      {/* ------------------------------------------------ right: the scene */}
      <Scene />
    </main>
  );
}
