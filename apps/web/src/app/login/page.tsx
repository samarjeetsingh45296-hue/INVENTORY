'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { PasswordInput } from '@/components/password-input';
import { AlertCircle } from 'lucide-react';

/** What went wrong, said inside the card. `fields` are the inputs to tint. */
interface Fault {
  title: string;
  detail: string;
  fields: Array<'email' | 'password' | 'code'>;
}

function faultFor(err: unknown, step: Step): Fault {
  if (step === 'mfa') {
    return {
      title: err instanceof ApiError && err.status !== 401 ? err.message : "That code didn't match.",
      detail: 'Check your authenticator app and enter the current code.',
      fields: ['code'],
    };
  }
  if (err instanceof ApiError && err.status === 401) {
    return {
      title: 'Invalid email or password.',
      detail: 'Please verify your credentials and try again.',
      fields: ['email', 'password'],
    };
  }
  if (err instanceof ApiError && err.status === 403) {
    return { title: err.message, detail: 'Contact your administrator if this is unexpected.', fields: [] };
  }
  if (err instanceof ApiError && err.status === 429) {
    return { title: 'Too many attempts.', detail: 'Please wait a moment before trying again.', fields: [] };
  }
  return {
    title: 'Could not sign in.',
    detail: err instanceof ApiError ? err.message : 'Please check your connection and try again.',
    fields: [],
  };
}

/**
 * The inline error. It grows into the card (250-350ms, soft ease, a few
 * pixels of rise) and folds back the same way; the node stays until the
 * fold has finished so nothing beneath it jumps.
 */
function InlineError({
  fault, shown, onGone,
}: { fault: Fault | null; shown: boolean; onGone: () => void }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!shown) { setOn(false); return; }
    // One tick after mount, so the node starts collapsed and transitions
    // open. A timer, not a frame: background tabs still get their frame
    // later, and the message must never be left waiting on one.
    const id = window.setTimeout(() => setOn(true), 20);
    return () => window.clearTimeout(id);
  }, [shown, fault]);
  if (!fault) return null;
  return (
    <div
      className="si-fault"
      data-show={on || undefined}
      onTransitionEnd={(e) => {
        if (!shown && e.target === e.currentTarget && e.propertyName === 'opacity') onGone();
      }}
    >
      <div className="si-fault-clip">
        <div className="si-fault-box" role="alert" aria-live="polite">
          <span className="si-fault-ico" aria-hidden>
            <AlertCircle size={15} strokeWidth={2.2} />
          </span>
          <span className="si-fault-text">
            <span className="si-fault-title">{fault.title}</span>
            <span className="si-fault-detail">{fault.detail}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

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

/**
 * The backdrop files. The bundled recording is the reference itself and
 * exists only at 1134x720; a higher-resolution clip with the same framing
 * can be dropped into public/ and pointed at here, without touching code.
 * The poster is a still of the same frame, so the first paint is sharp and
 * never blank while the video decodes.
 */
const BG_VIDEO = process.env.NEXT_PUBLIC_LOGIN_BG_VIDEO || '/login-bg.mp4';
const BG_POSTER = process.env.NEXT_PUBLIC_LOGIN_BG_POSTER || '/login-bg.webp';
const PANEL = { left: 0.120, right: 0.462, top: 0.109, bottom: 0.902 };

/**
 * The decorative row under the Sign in button: six morphing characters in
 * brand colours. Shapes and motion live in CSS (.si-blob*); each blob only
 * carries its colour, eye colour, shape family and phase.
 */
const BLOBS: Array<{ c: string; eye: string; shape: 'round' | 'drop' | 'cloud' }> = [
  { c: '#9a9a9e', eye: '#0b0b0c', shape: 'drop' },
  { c: '#f4f2ef', eye: '#0b0b0c', shape: 'round' },
  { c: '#ff2e2e', eye: '#ffffff', shape: 'cloud' },
  { c: '#2a2a2e', eye: '#ffffff', shape: 'round' },
  { c: '#ff6b6b', eye: '#0b0b0c', shape: 'drop' },
  { c: '#d6d6d9', eye: '#0b0b0c', shape: 'cloud' },
];

function BlobRow() {
  return (
    <div className="si-blobs" aria-hidden>
      {BLOBS.map((b, i) => (
        <svg
          key={i}
          className="si-blob"
          viewBox="0 0 40 40"
          data-shape={b.shape}
          style={{ '--c': b.c, '--eye': b.eye, '--d': `${i * 0.22}s` } as React.CSSProperties}
        >
          <path className="si-blob-body" d="M20 4 C28.8 4 36 11.2 36 20 C36 28.8 28.8 36 20 36 C11.2 36 4 28.8 4 20 C4 11.2 11.2 4 20 4 Z" />
          <rect className="si-blob-eye" x="13.5" y="14" width="4" height="9" rx="2" />
          <rect className="si-blob-eye" x="22.5" y="14" width="4" height="9" rx="2" />
        </svg>
      ))}
    </div>
  );
}

/** One item in the entrance stagger. Delay is in seconds. */
function Rise({ d, className = '', children }: { d: number; className?: string; children: ReactNode }) {
  return (
    <div className={`si-in ${className}`} style={{ '--d': `${d}s` } as React.CSSProperties}>
      {children}
    </div>
  );
}

interface Box { left: number; top: number; width: number; height: number }
/**
 * The panel's screen box, plus how much of it (if any) the screen cuts off
 * at the top and bottom, so its content can stay clear of the edges.
 */
interface Fit extends Box { cutTop: number; cutBottom: number }

/** Smallest gap the panel's content keeps from the top and bottom of the screen. */
const EDGE = 16;

/**
 * Where the video's panel lands on screen. The recording covers the whole
 * viewport - no bars, no frame - so its glass window stays centred, and on
 * a short, wide screen the window's top and bottom are cropped along with
 * the scene. The panel follows the window exactly; when the crop reaches
 * it, the panel's padding grows so the form never slides off the screen.
 */
/**
 * Placement is unknown until the first measurement on the client; that
 * state is `undefined`, and nothing panel-shaped is drawn during it. Below
 * 1024px it becomes `null`: the ordinary centred card.
 */
function useVideoPanel(): Fit | null | undefined {
  const [fit, setFit] = useState<Fit | null | undefined>(undefined);
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
      const top = oy + PANEL.top * rh;
      const bottom = oy + PANEL.bottom * rh;
      setFit({
        left: ox + PANEL.left * rw,
        top,
        width: (PANEL.right - PANEL.left) * rw,
        height: bottom - top,
        cutTop: Math.max(0, EDGE - top),
        cutBottom: Math.max(0, bottom - (vh - EDGE)),
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
      src={BG_VIDEO}
      poster={BG_POSTER}
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
  const [fault, setFault] = useState<Fault | null>(null);
  const [faultShown, setFaultShown] = useState(false);
  const [busy, setBusy] = useState(false);

  /** Typing hides the message; the person is already fixing it. */
  const hideFault = () => { if (faultShown) setFaultShown(false); };
  const invalid = (f: 'email' | 'password' | 'code') =>
    faultShown && fault?.fields.includes(f) ? true : undefined;

  /** Fade the current stack out, swap, and let the next one rise in. */
  const go = (next: Step) => {
    setLeaving(true);
    window.setTimeout(() => {
      setFault(null);
      setFaultShown(false);
      setStep(next);
      setLeaving(false);
    }, 260);
  };

  // Mount-time safety: nothing should be stuck invisible if a transition is
  // interrupted by unmount.
  useEffect(() => () => setLeaving(false), []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    // A previous message fades out while the new attempt runs; a new one
    // takes its place if this attempt fails too. Inputs are never touched.
    setFaultShown(false);
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
      setFault(faultFor(err, step));
      setFaultShown(true);
    } finally {
      setBusy(false);
    }
  }

  // On large screens the panel is pinned to the video's own window; below
  // that the video is scenery and the panel is an ordinary centred card.
  // Where the screen crops the window, the panel's own padding grows by the
  // same amount, so brand and footer stay visible and the form stays centred
  // in what can actually be seen.
  const panelStyle: React.CSSProperties = place
    ? {
        position: 'absolute',
        left: place.left,
        top: place.top,
        width: place.width,
        height: place.height,
        paddingTop: 40 + place.cutTop,
        paddingBottom: 40 + place.cutBottom,
      }
    : {};

  return (
    <main className={`si-page relative grid min-h-screen place-items-center overflow-hidden p-4 ${play ? 'si-play' : ''}`}>
      <Backdrop />

      {/* Sharpening for the backdrop. The recording exists only at 720p and is
          stretched to fill the screen; this 3x3 kernel (weights sum to 1, so
          brightness is untouched) restores edge definition on the upscale.
          Applied through CSS filter: url(#si-sharpen) on the video. */}
      <svg width="0" height="0" aria-hidden style={{ position: 'absolute' }}>
        <filter id="si-sharpen" colorInterpolationFilters="sRGB">
          <feConvolveMatrix
            order="3"
            kernelMatrix="0 -0.35 0 -0.35 2.4 -0.35 0 -0.35 0"
            preserveAlpha="true"
            edgeMode="duplicate"
          />
        </filter>
      </svg>

      {/* Nothing is drawn until placement is known. The old fallback - a
          centred card rendered before the hook had measured the screen -
          flashed as a black rectangle for one frame on every load. */}
      {place !== undefined && (
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
                      data-invalid={invalid('email')}
                      onChange={(e) => { setEmail(e.target.value); hideFault(); }}
                    />
                  </Rise>
                  <Rise d={0.12}>
                    <PasswordInput
                      id="password"
                      placeholder="Enter Password"
                      autoComplete="current-password"
                      required
                      value={password}
                      data-invalid={invalid('password')}
                      onChange={(e) => { setPassword(e.target.value); hideFault(); }}
                    />
                  </Rise>
                  <InlineError fault={fault} shown={faultShown} onGone={() => setFault(null)} />
                  <Rise d={0.18} className="pt-2">
                    <button type="submit" className="si-cta" disabled={busy}>
                      <span className="si-shine" aria-hidden />
                      <span>{busy ? 'Signing in...' : 'Sign in'}</span>
                    </button>
                  </Rise>
                  <Rise d={0.24} className="pt-6">
                    <BlobRow />
                  </Rise>
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
                    data-invalid={invalid('code')}
                    onChange={(e) => { setCode(e.target.value); hideFault(); }}
                  />
                </Rise>
                <InlineError fault={fault} shown={faultShown} onGone={() => setFault(null)} />
                <Rise d={0.12} className="pt-2">
                  <button type="submit" className="si-cta" disabled={busy}>
                    <span className="si-shine" aria-hidden />
                    <span>{busy ? 'Verifying...' : 'Verify'}</span>
                  </button>
                </Rise>
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
      )}
    </main>
  );
}
