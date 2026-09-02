'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { PasswordInput } from '@/components/password-input';

/* -------------------------------------------------------------------------
   The backdrop: a hazy coastal seascape painted onto a canvas, then re-read
   and re-drawn as a dot matrix - which is what gives the reference its look
   of a painting resolving out of a grid. It fills the whole viewport.

   Both the painting and the dot layer are rendered once into offscreen
   canvases; each frame only composites them and flickers a handful of dots,
   so a full-screen grid stays cheap.
------------------------------------------------------------------------- */
function DitheredBackdrop() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let painting: HTMLCanvasElement | null = null;
    let dotLayer: HTMLCanvasElement | null = null;
    let bright: Array<{ x: number; y: number; s: number }> = [];
    let raf = 0;

    /** The seascape, drawn once at the canvas's size. */
    const paint = (c: CanvasRenderingContext2D, W: number, H: number) => {
      // Deterministic jitter, so a resize repaints the same picture.
      let seed = 20260901;
      const rnd = () => {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        return seed / 4294967296;
      };

      const HORIZON = H * 0.605;

      // --- Sky: cool at the top, warming into the haze at the horizon.
      const sky = c.createLinearGradient(0, 0, 0, HORIZON);
      sky.addColorStop(0, '#7d95a3');
      sky.addColorStop(0.22, '#9fadb2');
      sky.addColorStop(0.5, '#c9c6b4');
      sky.addColorStop(0.78, '#e8dcc2');
      sky.addColorStop(1, '#efe4cb');
      c.fillStyle = sky;
      c.fillRect(0, 0, W, HORIZON + 2);

      const blob = (
        cx: number, cy: number, rx: number, ry: number, col: string, a: number,
      ) => {
        const g = c.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
        g.addColorStop(0, col.replace('$', String(a)));
        g.addColorStop(0.55, col.replace('$', String(a * 0.42)));
        g.addColorStop(1, col.replace('$', '0'));
        c.fillStyle = g;
        c.beginPath();
        c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        c.fill();
      };

      c.filter = 'blur(3px)';

      // --- Cloud mass: many overlapping puffs, warm below and cool above.
      for (let i = 0; i < 78; i++) {
        const cx = W * (rnd() * 1.14 - 0.07);
        const cy = HORIZON * (0.04 + rnd() * 0.92);
        const rx = W * (0.05 + rnd() * 0.15);
        const ry = rx * (0.3 + rnd() * 0.34);
        const lowInSky = cy / HORIZON;
        const warm = rnd() < 0.35 + lowInSky * 0.5;
        blob(cx, cy, rx, ry,
          warm ? 'rgba(253,247,229,$)' : 'rgba(178,192,199,$)',
          0.12 + rnd() * 0.3);
      }
      // Torn blue breaks high up, so the sky is not a single wash.
      for (let i = 0; i < 12; i++) {
        blob(W * rnd(), HORIZON * (0.04 + rnd() * 0.3),
          W * (0.04 + rnd() * 0.1), H * (0.02 + rnd() * 0.05),
          'rgba(104,128,145,$)', 0.14 + rnd() * 0.2);
      }
      // The light burning through, upper middle-right.
      blob(W * 0.6, HORIZON * 0.52, W * 0.34, H * 0.26, 'rgba(255,248,224,$)', 0.6);

      // --- Sea
      const sea = c.createLinearGradient(0, HORIZON, 0, H);
      sea.addColorStop(0, '#a8b0ae');
      sea.addColorStop(0.1, '#7d8f95');
      sea.addColorStop(0.45, '#5a707a');
      sea.addColorStop(1, '#41565f');
      c.fillStyle = sea;
      c.fillRect(0, HORIZON, W, H - HORIZON);

      // Swell: long low strokes, closer ones bigger and brighter.
      c.lineCap = 'round';
      for (let i = 0; i < 150; i++) {
        const d = rnd();
        const y = HORIZON + (H - HORIZON) * (d * d);
        const depth = d;
        const x0 = W * (rnd() * 1.1 - 0.05);
        const len = W * (0.05 + rnd() * 0.28) * (0.4 + depth);
        c.strokeStyle = rnd() > 0.42
          ? `rgba(240,243,238,${0.05 + depth * 0.42})`
          : `rgba(44,62,70,${0.05 + depth * 0.22})`;
        c.lineWidth = 0.8 + depth * 5 + rnd() * 1.5;
        c.beginPath();
        c.moveTo(x0, y);
        c.bezierCurveTo(
          x0 + len * 0.3, y - 2 - depth * 3,
          x0 + len * 0.7, y + 2 + depth * 3,
          x0 + len, y,
        );
        c.stroke();
      }
      // Breaking foam, as irregular patches rather than tidy lines.
      for (let i = 0; i < 90; i++) {
        const d = rnd();
        const y = HORIZON + (H - HORIZON) * (0.25 + d * d * 0.75);
        blob(W * rnd(), y,
          W * (0.01 + rnd() * 0.05), H * (0.004 + rnd() * 0.016),
          'rgba(248,250,246,$)', 0.12 + d * 0.45);
      }

      // --- The castle on its headland: mid-distance, hazed by the air.
      const by = HORIZON + H * 0.012;
      c.fillStyle = 'rgba(120,118,104,0.85)';
      c.beginPath();
      c.moveTo(W * 0.46, by + H * 0.055);
      c.quadraticCurveTo(W * 0.56, by - H * 0.012, W * 0.72, by - H * 0.004);
      c.lineTo(W * 0.95, by + H * 0.012);
      c.lineTo(W * 0.95, by + H * 0.07);
      c.closePath();
      c.fill();

      const bx = W * 0.545;
      // Curtain wall, with its own battlements
      c.fillStyle = 'rgba(112,106,90,0.9)';
      c.fillRect(bx, by - H * 0.09, W * 0.245, H * 0.09);
      for (let k = 0; k < 26; k++) {
        c.fillRect(bx + (W * 0.245 / 26) * k, by - H * 0.097, W * 0.0055, H * 0.008);
      }
      // Towers: a tall keep among shorter drums, each a little different, so
      // the skyline is ragged rather than a row of equal blocks.
      const towers: Array<[number, number, number]> = [
        [0.0, 0.032, 0.135], [0.05, 0.026, 0.105], [0.098, 0.036, 0.185],
        [0.152, 0.026, 0.115], [0.196, 0.03, 0.15], [0.238, 0.024, 0.1],
      ];
      towers.forEach(([o, wf, hf], i) => {
        const tw = W * wf;
        const th = H * (hf + rnd() * 0.02);
        const v = 104 + i * 5;
        c.fillStyle = `rgba(${v},${v - 6},${v - 24},0.92)`;
        c.fillRect(bx + W * o, by - th, tw, th);
        // Battlements
        for (let k = 0; k < 4; k++) {
          c.fillRect(bx + W * o + (tw / 4) * k, by - th - H * 0.009, tw / 7, H * 0.009);
        }
        // Shadowed side, so each tower reads as round
        c.fillStyle = 'rgba(58,54,44,0.3)';
        c.fillRect(bx + W * o + tw * 0.62, by - th, tw * 0.38, th);
        // Window slits
        c.fillStyle = 'rgba(46,42,34,0.75)';
        for (let k = 0; k < 3; k++) {
          c.fillRect(bx + W * o + tw * 0.34, by - th * (0.8 - k * 0.22), tw * 0.13, th * 0.07);
        }
      });
      // Atmospheric haze laid back over the distance.
      const haze = c.createLinearGradient(0, by - H * 0.2, 0, by + H * 0.08);
      haze.addColorStop(0, 'rgba(233,224,203,0.34)');
      haze.addColorStop(1, 'rgba(233,224,203,0.06)');
      c.fillStyle = haze;
      c.fillRect(W * 0.36, by - H * 0.2, W * 0.64, H * 0.28);

      // --- Foreground: dark rocky shore sweeping in from the left.
      c.fillStyle = '#3c4038';
      c.beginPath();
      c.moveTo(0, H * 0.52);
      c.quadraticCurveTo(W * 0.06, H * 0.47, W * 0.12, H * 0.6);
      c.quadraticCurveTo(W * 0.17, H * 0.72, W * 0.16, H * 0.84);
      c.quadraticCurveTo(W * 0.15, H * 0.95, W * 0.22, H);
      c.lineTo(0, H);
      c.closePath();
      c.fill();
      for (let i = 0; i < 120; i++) {
        const t = rnd();
        const rx = W * (0.005 + t * t * 0.42);
        const ry = H * (0.72 + rnd() * 0.3);
        const s = W * (0.004 + rnd() * 0.02);
        const v = 26 + rnd() * 30;
        c.fillStyle = `rgba(${v},${v + 4},${v + 1},${0.4 + rnd() * 0.5})`;
        c.beginPath();
        c.ellipse(rx, ry, s, s * (0.45 + rnd() * 0.4), rnd() * 3, 0, Math.PI * 2);
        c.fill();
      }

      // Wet sand catching the light between rocks and water.
      c.fillStyle = 'rgba(206,196,170,0.42)';
      c.beginPath();
      c.moveTo(W * 0.1, H);
      c.quadraticCurveTo(W * 0.3, H * 0.83, W * 0.55, H * 0.795);
      c.lineTo(W * 0.62, H);
      c.closePath();
      c.fill();

      // The bare tree leaning off the headland.
      c.strokeStyle = 'rgba(26,30,27,0.95)';
      c.lineWidth = Math.max(2, W * 0.0022);
      const tx = W * 0.075;
      const ty = H * 0.52;
      c.beginPath();
      c.moveTo(tx, ty);
      c.lineTo(tx + W * 0.014, ty - H * 0.1);
      c.stroke();
      const fork = [tx + W * 0.014, ty - H * 0.1] as const;
      for (const [dx, dy] of [[0.03, -0.045], [-0.016, -0.05], [0.04, -0.012]] as const) {
        c.beginPath();
        c.moveTo(fork[0], fork[1]);
        c.lineTo(fork[0] + W * dx, fork[1] + H * dy);
        c.stroke();
      }

      c.filter = 'none';

      // --- Grain, so flat regions still carry paint texture.
      for (let i = 0; i < W * H * 0.005; i++) {
        const x = rnd() * W;
        const y = rnd() * H;
        c.fillStyle = rnd() > 0.5
          ? `rgba(255,252,240,${0.02 + rnd() * 0.06})`
          : `rgba(24,28,30,${0.02 + rnd() * 0.06})`;
        c.fillRect(x, y, 1.3, 1.3);
      }
    };

    /** Read the painting on a grid and bake the dot matrix into a layer. */
    const buildDots = (W: number, H: number) => {
      if (!painting) return;
      const pc = painting.getContext('2d');
      if (!pc) return;
      const data = pc.getImageData(0, 0, W, H).data;

      dotLayer = document.createElement('canvas');
      dotLayer.width = W;
      dotLayer.height = H;
      const dc = dotLayer.getContext('2d');
      if (!dc) return;

      const STEP = 12;
      const next: typeof bright = [];
      for (let y = STEP; y < H - 3; y += STEP) {
        for (let x = STEP; x < W - 3; x += STEP) {
          const i = (y * W + x) * 4;
          const r = data[i] ?? 0, g = data[i + 1] ?? 0, b = data[i + 2] ?? 0;
          const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
          const light = lum > 0.52;
          // Size tracks distance from mid-grey, so highlights and shadows
          // punch while mid-tones stay quiet.
          const contrast = Math.min(1, Math.abs(lum - 0.52) * 2.6);
          const s = 1.4 + contrast * 1.5;
          dc.globalAlpha = light ? 0.5 + contrast * 0.45 : 0.32 + contrast * 0.4;
          dc.fillStyle = light ? '#ffffff' : '#0d1216';
          dc.fillRect(x, y, s, s);
          if (light && contrast > 0.45) next.push({ x, y, s });
        }
      }
      dc.globalAlpha = 1;
      // Only the brightest dots twinkle - enough to feel alive, few enough
      // to stay free.
      bright = next.filter((_, i) => i % 3 === 0);
    };

    const resize = () => {
      const W = Math.max(1, Math.round(canvas.clientWidth));
      const H = Math.max(1, Math.round(canvas.clientHeight));
      // Skip only when this run has already painted at this size. Testing
      // the canvas alone is wrong: it keeps its size across a remount while
      // the offscreen layers start out null.
      if (painting && canvas.width === W && canvas.height === H) return;
      canvas.width = W;
      canvas.height = H;
      painting = document.createElement('canvas');
      painting.width = W;
      painting.height = H;
      const pc = painting.getContext('2d');
      if (pc) paint(pc, W, H);
      buildDots(W, H);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const render = (time: number) => {
      if (painting) ctx.drawImage(painting, 0, 0);
      if (dotLayer) ctx.drawImage(dotLayer, 0, 0);
      if (!still) {
        const t = time / 1000;
        for (let i = 0; i < bright.length; i++) {
          const d = bright[i];
          if (!d) continue;
          ctx.globalAlpha = 0.25 * (0.5 + 0.5 * Math.sin(t * 1.7 + i * 0.7));
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(d.x, d.y, d.s, d.s);
        }
        ctx.globalAlpha = 1;
        raf = requestAnimationFrame(render);
      }
    };
    raf = requestAnimationFrame(render);

    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return <canvas ref={ref} className="absolute inset-0 block h-full w-full" aria-hidden />;
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
    <main className="wf-page relative min-h-screen w-full overflow-hidden">
      <DitheredBackdrop />

      {/* The card floats at the centre of the artwork */}
      <div className="relative grid min-h-screen place-items-center p-4">
        <div className="wf-card w-full max-w-[336px] p-6 text-[#f4f4f2]">
          <div className="flex flex-col items-center text-center">
            <div className="wf-logo wf-in" style={{ animationDelay: '0.45s' }}>IS</div>
            <h1 className="wf-in mt-3.5 text-[19px] font-semibold tracking-tight"
                style={{ animationDelay: '0.53s' }}>
              Welcome to {process.env.NEXT_PUBLIC_APP_NAME ?? 'Inventory Suite'}
            </h1>
            <p className="wf-in mt-1 text-[12px] text-[rgb(244_244_242/0.5)]"
               style={{ animationDelay: '0.59s' }}>
              Every asset, every holder, one record.
            </p>
          </div>

          <form onSubmit={onSubmit} className="mt-5 space-y-2.5">
            {step === 'enrol' ? (
              <div className="wf-in space-y-3" style={{ animationDelay: '0.65s' }}>
                <h2 className="text-[13px] font-semibold">
                  Set up two-factor authentication
                </h2>
                <p className="text-[12px] leading-relaxed text-[rgb(244_244_242/0.55)]">
                  {enrolmentNotice ??
                    'Your role requires a second factor before you can sign in.'}
                </p>
                <p className="text-[12px] leading-relaxed text-[rgb(244_244_242/0.55)]">
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
                <div className="wf-field wf-in" style={{ animationDelay: '0.65s' }}>
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
                <div className="wf-field wf-in" style={{ animationDelay: '0.73s' }}>
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
                <div className="wf-in pt-1.5" style={{ animationDelay: '0.81s' }}>
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
                <p className="pt-0.5 text-[11px] leading-relaxed text-[rgb(244_244_242/0.5)]">
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
                className="rounded-xl px-3 py-2 text-[12px] leading-relaxed text-[#ffb4a2]"
                style={{ background: 'rgb(127 29 29 / 0.35)' }}
              >
                {error}
              </p>
            )}
          </form>

          <p className="wf-in mt-4 text-center text-[11.5px] text-[rgb(244_244_242/0.45)]"
             style={{ animationDelay: '0.89s' }}>
            No account? <span className="wf-link">Ask your administrator</span>
          </p>
        </div>
      </div>

      <p className="wf-caption">Central Contact Center - Parul University</p>
    </main>
  );
}
