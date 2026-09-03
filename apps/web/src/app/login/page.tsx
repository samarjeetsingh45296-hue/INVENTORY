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
const GOOGLE_CLIENT_ID = (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '').trim();

/* -------------------------------------------------------------------------
   Google Identity Services. The script is loaded on first use, then a token
   client opens Google's own sign-in window and hands back an access token,
   which the API verifies with Google before matching it to an account.
------------------------------------------------------------------------- */
interface GoogleTokenClient { requestAccessToken: (o?: { prompt?: string }) => void }
interface GoogleAccounts {
  oauth2: {
    initTokenClient: (cfg: {
      client_id: string;
      scope: string;
      callback: (r: { access_token?: string; error?: string; error_description?: string }) => void;
      error_callback?: (e: { type?: string; message?: string }) => void;
    }) => GoogleTokenClient;
  };
}
declare global { interface Window { google?: { accounts: GoogleAccounts } } }

let gisLoading: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!gisLoading) {
    gisLoading = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = 'https://accounts.google.com/gsi/client';
      el.async = true;
      el.onload = () => resolve();
      el.onerror = () => { gisLoading = null; reject(new Error('Could not load Google sign-in.')); };
      document.head.append(el);
    });
  }
  return gisLoading;
}

/** Opens Google's sign-in window and resolves with an access token. */
async function requestGoogleToken(): Promise<string> {
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: 'openid email profile',
      callback: (r) => {
        if (r.access_token) resolve(r.access_token);
        else reject(new Error(r.error_description || r.error || 'Google sign-in was cancelled.'));
      },
      error_callback: (e) =>
        reject(new Error(e.type === 'popup_closed' ? 'Google sign-in was closed before finishing.' : (e.message || 'Google sign-in failed.'))),
    });
    client.requestAccessToken();
  });
}

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
  const { login, loginWithGoogle, verifyMfa, enrolmentNotice } = useAuth();
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

  async function withGoogle() {
    setError(null);
    setNotice(null);
    if (!GOOGLE_CLIENT_ID) {
      setNotice(
        'Google sign-in needs a Google OAuth client id first. An administrator adds it as ' +
          'GOOGLE_CLIENT_ID (API) and NEXT_PUBLIC_GOOGLE_CLIENT_ID (web) - see .env.example.',
      );
      return;
    }
    setBusy(true);
    try {
      const token = await requestGoogleToken();
      const result = await loginWithGoogle(token);
      if (result === 'MFA_REQUIRED') go('mfa');
      else if (result === 'MFA_ENROLMENT_REQUIRED') go('enrol');
      else router.push('/dashboard');
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message
          : err instanceof Error ? err.message
          : 'Could not sign in with Google. Please try again.',
      );
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
                  <Rise d={0.18} className="pt-2">
                    <button type="submit" className="si-cta" disabled={busy}>
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

                <Rise d={0.24} className="mt-7">
                  <div className="si-divider">or</div>
                  <button
                    type="button"
                    className="si-social mt-4"
                    onClick={withGoogle}
                    disabled={busy}
                  >
                    <GoogleMark />
                    Continue with Google
                  </button>
                </Rise>

                <Rise d={0.3} className="mt-8">
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
