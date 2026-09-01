'use client';

/**
 * The 3D brand mark: a slowly turning glass cube carrying the "IS" monogram,
 * floating over its own shadow. Pure CSS transforms - no libraries - and it
 * inherits currentColor, so it reads correctly on the dark brand panel and on
 * the plain page alike. Styles live in globals.css under "3D logo cube".
 */
export function LogoCube({ size = 96, className = '' }: { size?: number; className?: string }) {
  const half = size / 2;
  const faces: Array<{ t: string; label?: string }> = [
    { t: 'rotateY(0deg)', label: 'IS' },
    { t: 'rotateY(90deg)', label: 'IS' },
    { t: 'rotateY(180deg)', label: 'IS' },
    { t: 'rotateY(270deg)', label: 'IS' },
    { t: 'rotateX(90deg)' },
    { t: 'rotateX(-90deg)' },
  ];
  return (
    <div className={`cube-wrap ${className}`} style={{ width: size }} aria-hidden>
      <div className="cube-scene" style={{ width: size, height: size }}>
        <div className="cube-float">
          <div className="cube">
            {faces.map((f, i) => (
              <div
                key={i}
                className="cube-face"
                style={{
                  transform: `${f.t} translateZ(${half}px)`,
                  fontSize: Math.round(size * 0.3),
                }}
              >
                {f.label}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="cube-shadow" style={{ width: size * 0.9 }} />
    </div>
  );
}
