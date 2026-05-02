/**
 * Slice L1 — circular portrait for a lobby seat. Mirrors the
 * visual contract of {@link PlayerPortrait} (slice 70-J) but
 * without the {@link WebPlayerView} + {@code useGameStore}
 * coupling so it can render off plain lobby data (commander art
 * URL + colorIdentity + name initial fallback).
 *
 * <p>L1 is the static-shell visual atom. If duplication with
 * PlayerPortrait becomes painful, slice L2 (wire WebTable) can
 * extract a shared {@code PortraitVisual} primitive — but for L1
 * the standalone path keeps the two surfaces decoupled while we
 * iterate on lobby-specific polish (host crown overlay,
 * ready halo accent).
 */
import { type CSSProperties, useMemo } from 'react';
import { computeHaloBackground, manaTokenForCode } from '../game/halo';
import type { LobbyColor } from './fixtures';

interface Props {
  /** Display name; first letter is used for the fallback initial. */
  name: string;
  /** Scryfall art-crop URL of the seat's commander, or null for fallback. */
  artUrl: string | null;
  /** WUBRG color identity for halo. Empty → neutral team ring. */
  colorIdentity: LobbyColor[];
  /** Sizes mirror PlayerPortrait; L1 only uses 'large' for seat cards. */
  size?: 'medium' | 'large';
  /** Renders a small crown badge over the top-right of the portrait. */
  isHost?: boolean;
  /** Adds a green ready accent ring outside the halo. */
  isReady?: boolean;
  /** Drives the halo pulse + multicolor rotation. */
  isActive?: boolean;
}

const SIZE_PX: Record<NonNullable<Props['size']>, number> = {
  medium: 80,
  large: 96,
};

const HALO_PADDING_PX: Record<NonNullable<Props['size']>, number> = {
  medium: 2,
  large: 2.5,
};

export function LobbySeatPortrait({
  name,
  artUrl,
  colorIdentity,
  size = 'large',
  isHost = false,
  isReady = false,
  isActive = false,
}: Props) {
  const sizePx = SIZE_PX[size];
  const paddingPx = HALO_PADDING_PX[size];

  const haloBackground = useMemo(
    () => computeHaloBackground(colorIdentity, false),
    [colorIdentity],
  );

  const rotates = colorIdentity.length > 1 && isActive;
  const pulses = isActive;

  const bloomExtentPx = paddingPx <= 2 ? 8 : 11;
  const bloomBlurPx = paddingPx <= 2 ? 7 : 9;

  const wrapperStyle: CSSProperties = {
    position: 'relative',
    isolation: 'isolate',
    width: sizePx,
    height: sizePx,
    borderRadius: '50%',
    flexShrink: 0,
  };

  const ringStyle: CSSProperties = {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    background: haloBackground,
    padding: `${paddingPx}px`,
    WebkitMask:
      'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
    WebkitMaskComposite: 'xor',
    mask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
    maskComposite: 'exclude',
    borderRadius: '50%',
  };

  const bloomStyle: CSSProperties = {
    position: 'absolute',
    top: `-${bloomExtentPx}px`,
    right: `-${bloomExtentPx}px`,
    bottom: `-${bloomExtentPx}px`,
    left: `-${bloomExtentPx}px`,
    borderRadius: '50%',
    background: haloBackground,
    filter: `blur(${bloomBlurPx}px)`,
    opacity: 0.6,
    zIndex: -1,
  };

  // Outer "ready" accent — soft green ring outside the halo. Visually
  // distinct from the color-identity halo so it never collides with
  // a Selesnya-green commander's halo (ring is solid green; halo
  // would be the conic-gradient).
  const readyRingStyle: CSSProperties | undefined = isReady
    ? {
        position: 'absolute',
        top: -5,
        right: -5,
        bottom: -5,
        left: -5,
        borderRadius: '50%',
        border: '2px solid var(--color-status-success)',
        boxShadow: '0 0 12px rgba(91, 184, 114, 0.45)',
        pointerEvents: 'none',
      }
    : undefined;

  const parentAnim = rotates ? 'animate-halo-rotate' : '';
  const childAnim = pulses ? 'animate-player-active-halo' : '';

  return (
    <div
      data-testid="lobby-seat-portrait"
      data-size={size}
      style={wrapperStyle}
    >
      {readyRingStyle && (
        <div data-testid="lobby-seat-portrait-ready-ring" style={readyRingStyle} aria-hidden="true" />
      )}

      {artUrl ? (
        <img
          src={artUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          style={{
            width: '100%',
            height: '100%',
            borderRadius: '50%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
      ) : (
        <FallbackInitial
          name={name}
          colorIdentity={colorIdentity}
          sizePx={sizePx}
        />
      )}

      <div
        aria-hidden="true"
        data-essential-motion="true"
        className={'pointer-events-none absolute inset-0 ' + parentAnim}
      >
        <div className={'pointer-events-none ' + childAnim} style={bloomStyle} />
        <div className={'pointer-events-none ' + childAnim} style={ringStyle} />
      </div>

      {isHost && <HostCrown />}
    </div>
  );
}

function FallbackInitial({
  name,
  colorIdentity,
  sizePx,
}: {
  name: string;
  colorIdentity: LobbyColor[];
  sizePx: number;
}) {
  const initial = (name?.[0] ?? '?').toUpperCase();
  const bgColor =
    colorIdentity.length === 0
      ? 'var(--color-surface-card)'
      : manaTokenForCode(colorIdentity[0]!);
  const fontSize = Math.max(12, Math.round(sizePx * 0.5));
  return (
    <div
      data-testid="lobby-seat-portrait-fallback"
      style={{
        width: '100%',
        height: '100%',
        borderRadius: '50%',
        backgroundColor: bgColor,
        color: 'var(--color-text-primary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 600,
        fontSize: `${fontSize}px`,
        lineHeight: 1,
        userSelect: 'none',
      }}
    >
      {initial}
    </div>
  );
}

function HostCrown() {
  return (
    <div
      data-testid="lobby-seat-host-crown"
      aria-label="Host"
      style={{
        position: 'absolute',
        top: -4,
        right: -4,
        width: 22,
        height: 22,
        borderRadius: '50%',
        background:
          'radial-gradient(circle, var(--color-mana-multicolor) 30%, #b58a2a 100%)',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="#1A1206"
        stroke="#1A1206"
        strokeWidth="0.6"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M3 18h18l-2-9-4 3-3-6-3 6-4-3z" />
      </svg>
    </div>
  );
}
