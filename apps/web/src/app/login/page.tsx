'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { LogoCube } from '@/components/logo-cube';
import { PasswordInput } from '@/components/password-input';

/**
 * The shimmering ascii-dither texture from the reference recording: a grid of
 * characters over the whole scene, cells lighting up at random and decaying,
 * so the painting looks like it is continuously dissolving into type.
 */
function AsciiShimmer() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const CHARS = '.:-=+*#';
    const CELL = 16;
    let cols = 0;
    let rows = 0;
    let cells = new Float32Array(0);

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      cols = Math.ceil(canvas.width / CELL);
      rows = Math.ceil(canvas.height / CELL);
      cells = new Float32Array(cols * rows);
    };
    resize();
    window.addEventListener('resize', resize);

    const timer = window.setInterval(() => {
      // A few cells flare each tick; everything decays toward dark.
      for (let k = 0; k < cols * rows * 0.02; k++) {
        cells[Math.floor(Math.random() * cells.length)] = 1;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.font = '11px ui-monospace, monospace';
      for (let i = 0; i < cells.length; i++) {
        const v = cells[i] ?? 0;
        if (v < 0.06) continue;
        cells[i] = v * 0.9;
        ctx.globalAlpha = v * 0.26;
        ctx.fillStyle = '#20242a';
        const ch = CHARS[Math.min(CHARS.length - 1, Math.floor(v * CHARS.length))] ?? '.';
        ctx.fillText(ch, (i % cols) * CELL, Math.floor(i / cols) * CELL + 11);
      }
      ctx.globalAlpha = 1;
    }, 130);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={ref} className="absolute inset-0 h-full w-full" aria-hidden />;
}

/** Drifting clouds; negative delays scatter them mid-journey from the start. */
function Clouds() {
  const clouds = [
    { top: '4%', w: 420, h: 130, dur: 150, delay: -20 },
    { top: '12%', w: 560, h: 170, dur: 190, delay: -90 },
    { top: '2%', w: 340, h: 110, dur: 130, delay: -60 },
    { top: '22%', w: 480, h: 140, dur: 220, delay: -140 },
    { top: '30%', w: 380, h: 110, dur: 170, delay: -40 },
  ];
  return (
    <>
      {clouds.map((c, i) => (
        <div
          key={i}
          className="cloud"
          style={{
            top: c.top, width: c.w, height: c.h,
            animationDuration: `${c.dur}s`, animationDelay: `${c.delay}s`,
          }}
        />
      ))}
    </>
  );
}

/** The coast: castle skyline, cliff, and sea with slowly drifting wave bands. */
function Coast() {
  return (
    <svg
      className="absolute inset-x-0 bottom-0 h-[46vh] w-full"
      viewBox="0 0 1440 420"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden
    >
      {/* Castle silhouette on the right, as in the painting */}
      <path
        fill="#3a4045"
        d="M950 200 v-48 h14 v-14 h10 v14 h14 v48 h30 v-70 h12 v-16 h10 v16 h12
           v70 h36 v-40 h12 v-12 h10 v12 h12 v40 h40 v130 h-222 z"
      />
      <path fill="#31363b" d="M880 240 h340 v100 h-340 z" />
      {/* Cliff mass on the left */}
      <path fill="#2c3136" d="M0 230 q90 -50 190 -22 q70 18 110 62 v150 H0 z" />
      {/* Sea */}
      <rect y="300" width="1440" height="120" fill="#454d52" />
      {/* Wave bands: each drawn twice as wide and drifting left forever */}
      <g className="wave-band" style={{ animationDuration: '26s' }}>
        <path
          fill="none" stroke="#8b9494" strokeWidth="3" opacity="0.7"
          d="M0 316 q45 -10 90 0 t90 0 t90 0 t90 0 t90 0 t90 0 t90 0 t90 0
             t90 0 t90 0 t90 0 t90 0 t90 0 t90 0 t90 0 t90 0 t90 0 t90 0
             t90 0 t90 0 t90 0 t90 0 t90 0 t90 0"
        />
      </g>
      <g className="wave-band" style={{ animationDuration: '38s' }}>
        <path
          fill="none" stroke="#5f686c" strokeWidth="4" opacity="0.8"
          d="M0 348 q60 -12 120 0 t120 0 t120 0 t120 0 t120 0 t120 0 t120 0
             t120 0 t120 0 t120 0 t120 0 t120 0 t120 0 t120 0 t120 0 t120 0
             t120 0 t120 0"
        />
      </g>
      <g className="wave-band" style={{ animationDuration: '52s' }}>
        <path
          fill="none" stroke="#6d7678" strokeWidth="5" opacity="0.5"
          d="M0 386 q75 -14 150 0 t150 0 t150 0 t150 0 t150 0 t150 0 t150 0
             t150 0 t150 0 t150 0 t150 0 t150 0 t150 0 t150 0"
        />
      </g>
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
    <main className="login-scene relative min-h-screen overflow-hidden">
      {/* Sky */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(#a9b2b5 0%, #c4c9c5 40%, #b3bab9 58%, #98a2a4 100%)',
        }}
      />
      <Clouds />
      <Coast />
      <AsciiShimmer />
      {/* Vignette pulls the eye to the card */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at 50% 42%, transparent 40%, rgb(20 22 24 / 0.28) 100%)',
        }}
      />

      {/* The card */}
      <section className="relative grid min-h-screen place-items-center px-4 py-10">
        <div className="login-card w-full max-w-[21rem] rounded-2xl p-6">
          <div className="mb-5 flex flex-col items-center text-center">
            <div style={{ color: '#f5f5f4' }}>
              <LogoCube size={52} />
            </div>
            <h1 className="mt-1 text-[17px] font-semibold tracking-tight">
              Welcome to {process.env.NEXT_PUBLIC_APP_NAME ?? 'Inventory Suite'}
            </h1>
            <p className="mt-1 text-[12px] text-[rgb(245_245_244/0.55)]">
              Every asset, every holder, one record.
            </p>
          </div>

          <form onSubmit={onSubmit} className="space-y-3.5">
            {step === 'enrol' ? (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold">Set up two-factor authentication</h2>
                <p className="text-[12px] text-[rgb(245_245_244/0.6)]">
                  {enrolmentNotice ??
                    'Your role requires a second factor before you can sign in.'}
                </p>
                <p className="text-[12px] text-[rgb(245_245_244/0.6)]">
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
                <p className="mt-2 text-xs text-[rgb(245_245_244/0.55)]">
                  Enter the 6-digit code from your authenticator app, or one of your
                  recovery codes.
                </p>
              </div>
            )}

            {error && (
              <p
                role="alert"
                className="rounded-md px-3 py-2 text-[12px]"
                style={{ background: 'rgb(127 29 29 / 0.35)', color: '#fca5a5' }}
              >
                {error}
              </p>
            )}

            {step === 'enrol' ? (
              <button
                type="button"
                className="w-full rounded-full border border-[rgb(255_255_255/0.2)]
                           py-2 text-[13px] font-medium transition hover:bg-[rgb(255_255_255/0.08)]"
                onClick={() => setStep('credentials')}
              >
                Back to sign in
              </button>
            ) : (
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-full bg-[#f5f5f4] py-2 text-[13px] font-semibold
                           text-[#141416] shadow transition hover:bg-white
                           active:scale-[0.98] disabled:opacity-50"
              >
                {busy ? 'Please wait...' : step === 'credentials' ? 'Sign in' : 'Verify'}
              </button>
            )}
          </form>

          <p className="mt-4 text-center text-[11px] text-[rgb(245_245_244/0.45)]">
            Access is created by an administrator. No account? Ask your admin.
          </p>
        </div>
      </section>

      <p
        className="absolute inset-x-0 bottom-3 text-center text-[10px] font-semibold
                   uppercase tracking-[0.3em] text-[rgb(30_34_38/0.5)]"
      >
        Central Contact Center - Parul University
      </p>
    </main>
  );
}
