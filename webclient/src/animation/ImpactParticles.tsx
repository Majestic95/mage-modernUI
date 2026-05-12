import { useMemo } from 'react';
import { DUST_DURATION_MS, EXILE_DURATION_MS } from './transitions';

/**
 * Slice 70-Z.4 — per-tile particle field accompanying a battlefield
 * destruction. Mounted as a sibling of the dying tile while its
 * exit animation runs.
 *
 * <p>Two presets share the same component:
 * <ul>
 *   <li><b>dust</b> (creature death) — N=10 particles drift
 *       DOWNWARD with random lateral spread + small scale tail.
 *       Earthy palette (zinc-700/600).</li>
 *   <li><b>exile</b> (permanent exiled) — N=16 particles burst
 *       RADIALLY (full 360° spread) with bright white-violet
 *       palette. Different geometry from dust so the visual reads
 *       as exile, not death.</li>
 * </ul>
 *
 * <p>Each particle is a small absolute-positioned div; per-particle
 * randomized {@code --p-dx} / {@code --p-dy} CSS vars feed the
 * shared {@code dust-particle-drift} keyframe (see index.css). The
 * keyframe animates {@code translate} from {@code 0,0} to the var-
 * driven offset over {@code DUST_DURATION_MS} (or
 * {@code EXILE_DURATION_MS}).
 *
 * <p>Random offsets are seeded once on mount via {@code useMemo}
 * keyed on cardId — re-seed only when the cardId changes (which
 * is also when the component re-mounts, so memo is just defensive).
 *
 * <p>Reduced motion: the keyframe is silenced by the global
 * prefers-reduced-motion media query — particles render but
 * collapse to 0.01ms duration, effectively invisible.
 */
export function ImpactParticles({
  kind,
  cardId,
  staggerMs = 0,
}: {
  kind: 'dust' | 'exile';
  cardId: string;
  /**
   * Optional animation-delay in ms — used by the board-wipe wave so
   * each tile's particles fire at staggered offsets after the
   * single ripple kicks off.
   */
  staggerMs?: number;
}): React.JSX.Element {
  const config = PRESETS[kind];
  const particles = useMemo(
    () => generateParticles(config.count, config.geometry, config.palette),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cardId, config.count, config.geometry, config.palette],
  );

  return (
    <div
      data-testid={kind === 'dust' ? 'tile-dust-particles' : 'tile-exile-particles'}
      data-card-id={cardId}
      aria-hidden="true"
      className="absolute inset-0 pointer-events-none"
    >
      {particles.map((p, i) => (
        <span
          key={i}
          className="absolute top-1/2 left-1/2 rounded-full"
          style={
            {
              ['--p-dx' as string]: `${p.dx}px`,
              ['--p-dy' as string]: `${p.dy}px`,
              width: `${config.particleSizePx}px`,
              height: `${config.particleSizePx}px`,
              backgroundColor: p.color,
              animation: `dust-particle-drift ${config.durationMs}ms ease-out forwards`,
              animationDelay: `${staggerMs}ms`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

interface Preset {
  count: number;
  geometry: 'downward' | 'radial';
  particleSizePx: number;
  // Palette of colors; each particle picks one at random on mount so
  // the burst reads as a mixed field rather than a single hue. For
  // dust (creature death): earthy zinc + warm ambers + orange embers
  // — burned-then-crumbled feel. For exile: single bright white-
  // violet (magical-removal feel).
  palette: readonly string[];
  durationMs: number;
}

const PRESETS: Record<'dust' | 'exile', Preset> = {
  dust: {
    count: 20,
    geometry: 'downward',
    particleSizePx: 7,
    palette: [
      'rgba(82, 82, 91, 0.85)',
      'rgba(120, 53, 15, 0.9)',
      'rgba(180, 83, 9, 0.9)',
      'rgba(234, 88, 12, 0.95)',
    ],
    durationMs: DUST_DURATION_MS,
  },
  exile: {
    count: 16,
    geometry: 'radial',
    particleSizePx: 5,
    palette: ['rgba(216, 180, 254, 0.9)'],
    durationMs: EXILE_DURATION_MS,
  },
};

interface ParticleOffset {
  dx: number;
  dy: number;
  color: string;
}

function generateParticles(
  count: number,
  geometry: 'downward' | 'radial',
  palette: readonly string[],
): ParticleOffset[] {
  const out: ParticleOffset[] = [];
  for (let i = 0; i < count; i++) {
    const color = palette[Math.floor(Math.random() * palette.length)]!;
    if (geometry === 'downward') {
      // Lateral spread ±40px, downward 32-80px. Widened from the
      // original ±32/24-56 (2026-05-12 tuning) so particles travel
      // further over the extended 1000ms duration — keeps per-particle
      // velocity roughly the same while doubling the dust footprint.
      const dx = Math.round((Math.random() - 0.5) * 80);
      const dy = Math.round(32 + Math.random() * 48);
      out.push({ dx, dy, color });
    } else {
      // Radial burst — N evenly-spaced angles + per-particle radius
      // jitter so the burst doesn't read as a perfect circle.
      const theta = (i / count) * Math.PI * 2;
      const r = 28 + Math.random() * 18;
      const dx = Math.round(Math.cos(theta) * r);
      const dy = Math.round(Math.sin(theta) * r);
      out.push({ dx, dy, color });
    }
  }
  return out;
}
