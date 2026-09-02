'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { PasswordInput } from '@/components/password-input';

/**
 * Sign-in, matched to the reference recording.
 *
 * The backdrop is the recording's own seascape - a Turner coast already
 * rendered through the character dither - served full-bleed from
 * public/login-scene.jpg, because drawing that painting in code was never
 * going to land. Over it sits one dark glass card that fades in as a single
 * unit, which is how the reference does it: no per-element stagger.
 */
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
    <main className="wf-page relative min-h-screen w-full overflow-hidden">
      <div className="wf-art" aria-hidden />

      <div className="relative grid min-h-screen place-items-center p-4">
        {/* ~29% of the artwork's width in the reference, capped so it stays
            a card rather than a panel on very wide monitors. */}
        <div className="wf-card w-full max-w-[27vw] min-w-[330px] p-8 text-[#f4f2ef]">
          <div className="flex flex-col items-center text-center">
            <div className="wf-logo">IS</div>
            <h1
              className="mt-4 text-[22px] font-semibold leading-[1.25] tracking-tight"
              style={{ textWrap: 'balance' }}
            >
              Welcome to {process.env.NEXT_PUBLIC_APP_NAME ?? 'Inventory Suite'}
            </h1>
            <p className="mt-1.5 text-[13px] text-[rgb(244_242_239/0.5)]">
              Every asset, every holder, one record.
            </p>
          </div>

          <form onSubmit={onSubmit} className="mt-7 space-y-3">
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
                <div className="pt-2">
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
                <p className="pt-0.5 text-[12px] leading-relaxed text-[rgb(244_242_239/0.5)]">
                  Enter the 6-digit code from your authenticator app, or one of
                  your recovery codes.
                </p>
                <button type="submit" className="wf-btn" disabled={busy}>
                  {busy ? 'Please wait...' : 'Verify'}
                </button>
              </>
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

      <p className="wf-caption">Central Contact Center - Parul University</p>
    </main>
  );
}
