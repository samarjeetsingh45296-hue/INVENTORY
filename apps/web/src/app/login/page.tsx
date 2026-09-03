'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { PasswordInput } from '@/components/password-input';

type Step = 'credentials' | 'mfa' | 'enrol';

// The sign-in page carries the product name the user chose for it; the
// env app name still drives the tab title and the rest of the app.
const APP = 'Inventory Manager';

/**
 * The backdrop video already contains a glass window whose left part is a
 * dark panel. Rather than draw a second window over it, the form panel is
 * laid exactly onto that region. These are its edges as fractions of the
 * video frame, measured from the recording; the hook below maps them to
 * screen pixels for whatever size the video is rendered at.
 */
const VIDEO = { w: 1134, h: 720 };
const PANEL = { left: 0.120, right: 0.462, top: 0.109, bottom: 0.902 };

/** One item in the entrance stagger. Delay is in seconds. */
function Rise({ d, className = '', children }: { d: number; className?: string; children: ReactNode }) {
  return (
    <div className={`si-in ${className}`} style={{ '--d': `${d}s` } as React.CSSProperties}>
      {children}
    </div>
  );
}

interface Fit { left: number; top: number; width: number; height: number }

/** Smallest gap the panel keeps from the top and bottom of the screen. */
const EDGE = 16;

/**
 * Where the video's panel lands on screen. The video always covers the
 * viewport - no bars - so on a short, wide screen the top and bottom of the
 * recording's window are cropped; the panel then clamps to the screen with
 * a small margin rather than following the window off the edge.
 */
function useVideoPanel(): Fit | null {
  const [fit, setFit] = useState<Fit | null>(null);
  useEffect(() => {
    const compute = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (vw < 1024) { setFit(null); return; }
      const scale = Math.max(vw / VIDEO.w, vh / VIDEO.h);
      const rw = VIDEO.w * scale;
      const rh = VIDEO.h * scale;
      const ox = (vw - rw) / 2;
      const oy = (vh - rh) / 2;
      const top = Math.max(EDGE, oy + PANEL.top * rh);
      const bottom = Math.min(vh - EDGE, oy + PANEL.bottom * rh);
      setFit({
        left: ox + PANEL.left * rw,
        top,
        width: (PANEL.right - PANEL.left) * rw,
        height: bottom - top,
      });
    };
    compute();
    // Observe the document rather than listening for window resize: it also
    // fires for zoom changes and emulated viewports, which resize does not.
    const ro = new ResizeObserver(compute);
    ro.observe(document.documentElement);
    window.addEventListener('resize', compute);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', compute);
    };
  }, []);
  return fit;
}

/**
 * The backdrop is the reference recording itself - a CRT on red dusk hills
 * behind a glass window - looping full-bleed. It stays still for anyone who
 * has asked for less motion.
 */
function Backdrop() {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      v.pause();
      return;
    }
    v.play().catch(() => undefined);
  }, []);
  return (
    <video
      ref={ref}
      className="si-video"
      src="/login-bg.mp4"
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      aria-hidden
    />
  );
}

export default function LoginPage() {
  const { login, verifyMfa, enrolmentNotice } = useAuth();
  const router = useRouter();
  const place = useVideoPanel();

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

  // On large screens the panel is pinned to the video's own window; below
  // that the video is scenery and the panel is an ordinary centred card.
  const panelStyle: React.CSSProperties = place
    ? { position: 'absolute', left: place.left, top: place.top, width: place.width, height: place.height }
    : {};

  return (
    <main className={`si-page relative grid min-h-screen place-items-center overflow-hidden p-4 ${play ? 'si-play' : ''}`}>
      <Backdrop />

      <section
        className={`si-panel flex flex-col p-8 sm:p-10 ${place ? '' : 'w-full max-w-[440px] min-h-[560px] rounded-[22px]'}`}
        style={panelStyle}
        data-pinned={!!place}
      >
        <Rise d={0}>
          <div className="si-brand">{APP}<span>.</span></div>
        </Rise>

        <div className="flex flex-1 items-center py-8">
          {/* Keyed on step so each stack replays its stagger from the top. */}
          <div key={step} className="si-stack w-full" data-leaving={leaving}>
            {step === 'credentials' && (
              <>
                <Rise d={0}>
                  <h1 className="mb-2 text-3xl font-bold tracking-tight">Sign in</h1>
                  <p className="text-[13.5px] leading-relaxed text-[#8e8e93]">
                    Sign in to your {APP} account and keep every asset, every
                    holder, and every record in one place.
                  </p>
                </Rise>

                <form onSubmit={onSubmit} className="mt-7 space-y-3.5">
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
                  <p className="text-[13.5px] leading-relaxed text-[#8e8e93]">
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
                    <span className="si-shine" aria-hidden />
                    <span>{busy ? 'Verifying...' : 'Verify'}</span>
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
                  <p className="text-[13.5px] leading-relaxed text-[#8e8e93]">
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
                    <span className="si-shine" aria-hidden />
                    <span>Back to sign in</span>
                  </button>
                </Rise>
              </div>
            )}
          </div>
        </div>

        <Rise d={0.3}>
          <p className="text-[10.5px] uppercase tracking-[0.22em] text-[#6a6a6e]">
            Central Contact Center - Parul University
          </p>
        </Rise>
      </section>
    </main>
  );
}
