'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { PasswordInput } from '@/components/password-input';

const TITLE = 'Inventory Manager';
const NOISE = '#8SXK$%@0123456789&*<>|=+';

/**
 * The wordmark resolves out of character noise - the same alphabet the
 * backdrop's dither is drawn from - one letter at a time, then a light
 * sweeps across the finished text. Skipped for anyone asking for less motion.
 */
function ScrambleTitle({ text }: { text: string }) {
  const [settled, setSettled] = useState(0);
  const [noise, setNoise] = useState('');
  const [sheen, setSheen] = useState(false);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setSettled(text.length);
      return;
    }
    let i = 0;
    const step = window.setInterval(() => {
      i += 1;
      setSettled(i);
      // Re-roll the unsettled tail so it visibly churns.
      setNoise(
        Array.from({ length: Math.max(0, text.length - i) },
          () => NOISE[Math.floor(Math.random() * NOISE.length)]).join(''),
      );
      if (i >= text.length) window.clearInterval(step);
    }, 55);
    return () => window.clearInterval(step);
  }, [text]);

  // Sweep a highlight once the word is whole, then drop the skin so the
  // title falls back to plain solid ink. `sheen` is deliberately absent from
  // the deps: including it re-ran this effect the moment it flipped true,
  // and the cleanup cancelled the very timeout meant to turn it off again.
  const done = settled >= text.length;
  useEffect(() => {
    if (!done) return;
    setSheen(true);
    const off = window.setTimeout(() => setSheen(false), 1500);
    return () => window.clearTimeout(off);
  }, [done]);

  return (
    <h1 className={`wf-title ${sheen ? 'wf-title-sheen' : ''}`} aria-label={text}>
      {/* Once settled the text is a bare node, not per-letter spans. Those
          spans keep an identity `transform` after their landing animation,
          and any transform on a child creates a stacking context that stops
          the parent's background-clip:text gradient painting through - which
          renders the whole title invisible. */}
      {done
        ? text
        : text.split('').map((ch, i) => (
            <span
              key={i}
              className="wf-title-ch"
              data-settled={i < settled}
              style={{ animationDelay: `${i * 0.02}s` }}
              aria-hidden
            >
              {i < settled ? ch : (noise[i - settled] ?? ch)}
            </span>
          ))}
    </h1>
  );
}

function GoogleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden>
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.7-2 5-4.4 6.6v5.5h7.1c4.2-3.8 6.6-9.5 6.6-16.1z" />
      <path fill="#34A853" d="M24 46c6 0 11-2 14.6-5.4l-7.1-5.5c-2 1.3-4.5 2.1-7.5 2.1-5.8 0-10.7-3.9-12.4-9.1H4.3v5.7C7.9 41.1 15.4 46 24 46z" />
      <path fill="#FBBC05" d="M11.6 28.1c-.4-1.3-.7-2.7-.7-4.1s.2-2.8.7-4.1v-5.7H4.3C2.8 17.1 2 20.4 2 24s.8 6.9 2.3 9.8l7.3-5.7z" />
      <path fill="#EA4335" d="M24 10.8c3.3 0 6.2 1.1 8.5 3.3l6.3-6.3C35 4.3 30 2 24 2 15.4 2 7.9 6.9 4.3 14.2l7.3 5.7c1.7-5.2 6.6-9.1 12.4-9.1z" />
    </svg>
  );
}

export default function LoginPage() {
  const { login, verifyMfa, enrolmentNotice } = useAuth();
  const router = useRouter();

  const [step, setStep] = useState<'credentials' | 'mfa' | 'enrol'>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
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
    <main className="wf-page relative min-h-screen w-full overflow-hidden">
      <div className="wf-art" aria-hidden />

      <div className="relative grid min-h-screen place-items-center p-4">
        <div className="wf-card-ring w-full max-w-[27vw] min-w-[336px]">
          <div className="wf-card p-8 text-[#f4f2ef]">
            <div className="flex flex-col items-center text-center">
              <div className="wf-logo">IS</div>
              <div className="mt-4">
                <ScrambleTitle text={TITLE} />
              </div>
              <p className="mt-2 text-[13px] text-[rgb(244_242_239/0.5)]">
                Every asset, every holder, one record.
              </p>
            </div>

            {step === 'credentials' && (
              <>
                <button
                  type="button"
                  className="wf-social mt-7"
                  onClick={() =>
                    setNotice(
                      'Google sign-in is not connected yet. Use your email and password, ' +
                      'or ask your administrator to enable it.',
                    )
                  }
                >
                  <GoogleMark />
                  Continue with Google
                </button>
                <div className="wf-divider my-4">or</div>
              </>
            )}

            <form
              onSubmit={onSubmit}
              className={step === 'credentials' ? 'space-y-3' : 'mt-7 space-y-3'}
            >
              {step === 'enrol' ? (
                <div className="space-y-3">
                  <h2 className="text-[14px] font-semibold">
                    Set up two-factor authentication
                  </h2>
                  <p className="text-[13px] leading-relaxed text-[rgb(244_242_239/0.55)]">
                    {enrolmentNotice ??
                      'Your role requires a second factor before you can sign in.'}
                  </p>
                  <p className="text-[13px] leading-relaxed text-[rgb(244_242_239/0.55)]">
                    The enrolment screen is not built yet. For now an administrator
                    can complete this from the API, or clear MFA_REQUIRED_ROLES in
                    the environment to sign in with a password alone.
                  </p>
                  <button type="button" className="wf-btn" onClick={() => setStep('credentials')}>
                    Back to sign in
                  </button>
                </div>
              ) : step === 'credentials' ? (
                <>
                  <div className="wf-field">
                    <div className="wf-inner">
                      <input
                        id="email"
                        type="email"
                        className="input"
                        autoComplete="username"
                        placeholder="Email address"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="wf-field">
                    <div className="wf-inner">
                      <PasswordInput
                        id="password"
                        autoComplete="current-password"
                        placeholder="Password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="pt-1">
                    <button type="submit" className="wf-btn" disabled={busy}>
                      {busy ? 'Please wait...' : 'Sign in'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="wf-field">
                    <div className="wf-inner">
                      <input
                        id="code"
                        inputMode="numeric"
                        className="input text-center tracking-[0.4em]"
                        autoComplete="one-time-code"
                        placeholder="000000"
                        required
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                      />
                    </div>
                  </div>
                  <p className="text-[12px] leading-relaxed text-[rgb(244_242_239/0.5)]">
                    Enter the 6-digit code from your authenticator app, or one of
                    your recovery codes.
                  </p>
                  <button type="submit" className="wf-btn" disabled={busy}>
                    {busy ? 'Please wait...' : 'Verify'}
                  </button>
                </>
              )}

              {notice && (
                <p className="rounded-2xl border border-[rgb(255_255_255/0.12)] px-3.5 py-2.5
                              text-[12.5px] leading-relaxed text-[rgb(244_242_239/0.66)]">
                  {notice}
                </p>
              )}

              {error && (
                <p
                  role="alert"
                  className="rounded-2xl px-3.5 py-2.5 text-[12.5px] leading-relaxed text-[#ffb4a2]"
                  style={{ background: 'rgb(127 29 29 / 0.35)' }}
                >
                  {error}
                </p>
              )}
            </form>

            <p className="mt-5 text-center text-[12px] text-[rgb(244_242_239/0.45)]">
              No account? <span className="wf-link">Ask your administrator</span>
            </p>
          </div>
        </div>
      </div>

      <p className="wf-caption">Central Contact Center - Parul University</p>
    </main>
  );
}
