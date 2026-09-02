'use client';

import {
  useEffect, useRef, useState,
  type FormEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent,
} from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { LogoCube } from '@/components/logo-cube';
import { PasswordInput } from '@/components/password-input';

/* -------------------------------------------------------------------------
   Embers: warm particles drifting up through the scene on one canvas.
------------------------------------------------------------------------- */
function Embers() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    interface P { x: number; y: number; r: number; vx: number; vy: number; a: number; tw: number }
    let parts: P[] = [];
    let raf = 0;

    const resize = () => {
      const box = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(box.width));
      canvas.height = Math.max(1, Math.floor(box.height));
      const n = Math.floor((canvas.width * canvas.height) / 4500);
      parts = Array.from({ length: n }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: 0.6 + Math.random() * 1.8,
        vx: (Math.random() - 0.5) * 0.16,
        vy: -(0.08 + Math.random() * 0.35),
        a: 0.15 + Math.random() * 0.5,
        tw: Math.random() * Math.PI * 2,
      }));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const tick = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of parts) {
        p.x += p.vx;
        p.y += p.vy;
        p.tw += 0.03;
        if (p.y < -4) { p.y = canvas.height + 4; p.x = Math.random() * canvas.width; }
        if (p.x < -4) p.x = canvas.width + 4;
        if (p.x > canvas.width + 4) p.x = -4;
        const glow = p.a * (0.65 + 0.35 * Math.sin(p.tw));
        ctx.globalAlpha = glow;
        ctx.fillStyle = p.r > 1.6 ? '#ffc09a' : '#ff8a5c';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return <canvas ref={ref} className="absolute inset-0 h-full w-full" aria-hidden />;
}

/* -------------------------------------------------------------------------
   The terminal's screen: a live inventory command center in miniature.
------------------------------------------------------------------------- */
function TerminalScreen() {
  const [stock, setStock] = useState(1851);
  const [moves, setMoves] = useState(214);

  useEffect(() => {
    const t = setInterval(() => {
      setStock((s) => s + (Math.random() < 0.6 ? 1 : 2));
      setMoves((s) => s + (Math.random() < 0.35 ? 1 : 0));
    }, 1500);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="lux-screen p-3 text-[#f3ded2]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-[8px] font-bold uppercase tracking-[0.28em] text-[#ff9a68]">
          Inventory Command
        </p>
        <span className="flex items-center gap-1 text-[7px] font-bold uppercase tracking-widest text-[#5eea8a]">
          <span className="lux-live-dot h-1.5 w-1.5 rounded-full bg-[#5eea8a]" /> Live
        </span>
      </div>

      {/* KPIs */}
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        {[
          { k: 'Stock', v: stock.toLocaleString() },
          { k: 'Moves', v: moves.toLocaleString() },
          { k: 'Health', v: '98%' },
        ].map((x) => (
          <div key={x.k} className="rounded-md border border-[rgb(255_255_255/0.08)] bg-[rgb(255_255_255/0.04)] px-1.5 py-1">
            <p className="text-[6px] uppercase tracking-[0.18em] text-[rgb(243_222_210/0.5)]">{x.k}</p>
            <p className="text-[11px] font-bold tabular-nums text-[#ffd9c0]">{x.v}</p>
          </div>
        ))}
      </div>

      {/* Trend + shipment route */}
      <svg viewBox="0 0 200 54" className="mt-2 w-full">
        <polyline
          className="lux-chart-line"
          points="4,44 28,38 52,40 76,28 100,31 124,20 148,24 172,12 196,16"
          fill="none" stroke="#ff8a5c" strokeWidth="2" strokeLinecap="round"
        />
        <line className="lux-route" x1="8" y1="50" x2="192" y2="50" stroke="#c0392b" strokeWidth="1.6" />
        {[8, 70, 132, 192].map((x) => (
          <circle key={x} cx={x} cy="50" r="2.2" fill="#ffb185" />
        ))}
      </svg>

      {/* Warehouse bars */}
      <div className="mt-1.5 flex h-9 items-end gap-1">
        {[0.9, 0.55, 0.75, 0.4, 0.85, 0.6, 0.7, 0.5, 0.95, 0.65].map((h, i) => (
          <div
            key={i}
            className="lux-bar flex-1 rounded-sm"
            style={{
              height: `${h * 100}%`,
              animationDelay: `${i * 0.24}s`,
              background: 'linear-gradient(to top, #8b1e1e, #ff6b35)',
            }}
          />
        ))}
      </div>

      <div className="lux-scanlines" />
      <div className="lux-screen-glow" />
    </div>
  );
}

/* -------------------------------------------------------------------------
   The full right-hand scene.
------------------------------------------------------------------------- */
function Scene() {
  const wrap = useRef<HTMLDivElement | null>(null);
  const pending = useRef(false);

  // Parallax: the terminal leans gently toward the pointer.
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = wrap.current;
    if (!el || pending.current) return;
    pending.current = true;
    const box = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const px = (e.clientX - box.left) / box.width - 0.5;
    const py = (e.clientY - box.top) / box.height - 0.5;
    requestAnimationFrame(() => {
      el.style.transform = `translate3d(${px * 18}px, ${py * 12}px, 0)`;
      pending.current = false;
    });
  };

  return (
    <div
      className="lux-scene lux-scene-on relative hidden overflow-hidden lg:block"
      onPointerMove={onMove}
      onPointerLeave={() => { if (wrap.current) wrap.current.style.transform = ''; }}
    >
      {/* Energy waves */}
      <div className="lux-wave" style={{ top: '8%', left: '4%', width: '58%', height: '38%',
        background: 'radial-gradient(circle, rgb(192 57 43 / 0.4), transparent 70%)', animationDuration: '13s' }} />
      <div className="lux-wave" style={{ top: '34%', right: '-6%', width: '52%', height: '42%',
        background: 'radial-gradient(circle, rgb(255 107 53 / 0.32), transparent 70%)', animationDuration: '17s', animationDelay: '-6s' }} />
      <div className="lux-wave" style={{ bottom: '2%', left: '18%', width: '64%', height: '36%',
        background: 'radial-gradient(circle, rgb(139 30 30 / 0.5), transparent 70%)', animationDuration: '21s', animationDelay: '-11s' }} />

      <div className="lux-rays" />
      <div className="lux-flare" style={{ top: '6%', right: '12%', width: 220, height: 220 }} />
      <div className="lux-fog" style={{ bottom: '14%', left: '-8%', width: '70%', height: '30%', animationDuration: '19s' }} />
      <div className="lux-fog" style={{ bottom: '4%', right: '-10%', width: '60%', height: '26%', animationDuration: '26s', animationDelay: '-9s' }} />
      <div className="lux-field-glow" />

      {/* The floating terminal */}
      <div className="lux-rise absolute inset-0 grid place-items-center">
        <div ref={wrap} className="lux-term-wrap">
          <div className="lux-term w-[340px] xl:w-[400px]">
            <div className="lux-monitor p-3.5">
              <TerminalScreen />
              <div className="mt-2 flex items-center justify-between px-1">
                <div className="flex gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#ff6b35]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-[rgb(255_255_255/0.25)]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-[rgb(255_255_255/0.25)]" />
                </div>
                <p className="text-[7px] font-bold uppercase tracking-[0.3em] text-[rgb(255_255_255/0.35)]">
                  IS-9000
                </p>
              </div>
            </div>
            {/* Stand */}
            <div className="mx-auto h-9 w-16 bg-gradient-to-b from-[#1a1a1e] to-[#0a0a0c]"
                 style={{ clipPath: 'polygon(28% 0, 72% 0, 100% 100%, 0 100%)' }} />
            <div className="mx-auto h-1.5 w-40 rounded-full bg-gradient-to-b from-[#212126] to-[#0a0a0c]" />
            {/* Ground glow */}
            <div className="mx-auto mt-3 h-4 w-64 rounded-[50%] bg-[rgb(255_107_53/0.3)] blur-xl" />
          </div>
        </div>
      </div>

      <Embers />
      <div className="lux-grain" />
    </div>
  );
}

/* -------------------------------------------------------------------------
   The page.
------------------------------------------------------------------------- */
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

  // Click ripple on the sign-in button.
  const ripple = (e: ReactMouseEvent<HTMLButtonElement>) => {
    const btn = e.currentTarget;
    const box = btn.getBoundingClientRect();
    const span = document.createElement('span');
    const size = Math.max(box.width, box.height);
    span.className = 'lux-ripple';
    span.style.width = span.style.height = `${size}px`;
    span.style.left = `${e.clientX - box.left - size / 2}px`;
    span.style.top = `${e.clientY - box.top - size / 2}px`;
    btn.appendChild(span);
    setTimeout(() => span.remove(), 650);
  };

  return (
    <main className="lux-page grid min-h-screen place-items-center p-3 md:p-6">
      <div className="lux-frame grid min-h-[min(92vh,860px)] w-full max-w-[1280px]
                      grid-cols-1 lg:grid-cols-[2fr_3fr]">
        <div className="lux-veil" />

        {/* Left: glass panel */}
        <section className="lux-left lux-enter-panel relative flex flex-col p-7 md:p-9">
          <div className="lux-up flex items-center gap-2.5" style={{ animationDelay: '0.8s' }}>
            <div style={{ color: '#f5f2ef' }}><LogoCube size={30} /></div>
            <span className="text-[13px] font-semibold tracking-tight text-[#f5f2ef]">
              {process.env.NEXT_PUBLIC_APP_NAME ?? 'Inventory Suite'}
            </span>
          </div>

          <div className="flex flex-1 flex-col justify-center py-8">
            <div className="lux-up" style={{ animationDelay: '0.95s' }}>
              <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-[#f5f2ef]">
                Command your
                <span className="bg-gradient-to-r from-[#ff9a68] to-[#ff6b35] bg-clip-text text-transparent"> inventory</span>.
              </h1>
              <p className="mt-2 text-[13px] leading-relaxed text-[rgb(245_242_239/0.55)]">
                Every asset, every holder, one record - the Central Contact
                Center&apos;s command center for equipment that never loses history.
              </p>
            </div>

            <form onSubmit={onSubmit} className="mt-7 space-y-4">
              {step === 'enrol' ? (
                <div className="lux-up space-y-3" style={{ animationDelay: '1.1s' }}>
                  <h2 className="text-sm font-semibold text-[#f5f2ef]">
                    Set up two-factor authentication
                  </h2>
                  <p className="text-[12px] text-[rgb(245_242_239/0.6)]">
                    {enrolmentNotice ??
                      'Your role requires a second factor before you can sign in.'}
                  </p>
                  <p className="text-[12px] text-[rgb(245_242_239/0.6)]">
                    The enrolment screen is not built yet. For now an administrator
                    can complete this from the API, or clear MFA_REQUIRED_ROLES in
                    the environment to sign in with a password alone.
                  </p>
                  <button
                    type="button"
                    className="w-full rounded-full border border-[rgb(255_255_255/0.2)] py-2
                               text-[13px] font-medium text-[#f5f2ef] transition
                               hover:bg-[rgb(255_255_255/0.08)]"
                    onClick={() => setStep('credentials')}
                  >
                    Back to sign in
                  </button>
                </div>
              ) : step === 'credentials' ? (
                <>
                  <div className="lux-field lux-up" data-filled={email !== ''}
                       style={{ animationDelay: '1.1s' }}>
                    <input
                      id="email"
                      type="email"
                      className="input"
                      autoComplete="username"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                    <label className="lux-label" htmlFor="email">Email address</label>
                  </div>
                  <div className="lux-field lux-up" data-filled={password !== ''}
                       style={{ animationDelay: '1.25s' }}>
                    <PasswordInput
                      id="password"
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <label className="lux-label" htmlFor="password">Password</label>
                  </div>
                  <div className="lux-up pt-1" style={{ animationDelay: '1.4s' }}>
                    <button type="submit" className="lux-btn" disabled={busy} onClick={ripple}>
                      {busy ? 'Please wait...' : 'Sign in'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="lux-field lux-up" data-filled={code !== ''}
                       style={{ animationDelay: '0.1s' }}>
                    <input
                      id="code"
                      inputMode="numeric"
                      className="input text-center text-lg tracking-[0.4em]"
                      autoComplete="one-time-code"
                      required
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                    />
                    <label className="lux-label" htmlFor="code">Authentication code</label>
                  </div>
                  <p className="text-xs text-[rgb(245_242_239/0.5)]">
                    Enter the 6-digit code from your authenticator app, or one of
                    your recovery codes.
                  </p>
                  <button type="submit" className="lux-btn" disabled={busy} onClick={ripple}>
                    {busy ? 'Please wait...' : 'Verify'}
                  </button>
                </>
              )}

              {error && (
                <p
                  role="alert"
                  className="rounded-xl border border-[rgb(255_107_53/0.3)] px-3 py-2
                             text-[12px] text-[#ffb4a2]"
                  style={{ background: 'rgb(127 29 29 / 0.3)' }}
                >
                  {error}
                </p>
              )}
            </form>
          </div>

          <p className="lux-up text-[11px] text-[rgb(245_242_239/0.4)]"
             style={{ animationDelay: '1.55s' }}>
            Access is created by an administrator. No account? Ask your admin.
            <span className="mt-1 block text-[10px] uppercase tracking-[0.25em] text-[rgb(245_242_239/0.3)]">
              Central Contact Center - Parul University
            </span>
          </p>
        </section>

        {/* Right: the cinematic scene */}
        <Scene />
      </div>
    </main>
  );
}
