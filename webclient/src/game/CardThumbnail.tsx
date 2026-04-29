import { useState } from 'react';
import type { WebCardView } from '../api/schemas';
import { scryfallImageUrl } from './scryfall';

/**
 * Inline mini-art thumbnail for chip-style renders (slice 43). Pulls
 * Scryfall's {@code art_crop} version (just the framed illustration,
 * no name banner / cost / type strip) and renders it as a small
 * square at the leading edge of the chip. Hides itself on error so
 * a missing print falls back to text-only chip — no broken-image
 * icon.
 *
 * <p>Service worker (slice 35) caches every Scryfall response; the
 * second time the same card renders, the image is on disk.
 *
 * <p>{@code alt=""} marks the image as decorative — every chip
 * pairs the thumbnail with the card's name in text, so a screen
 * reader gets the full information without the redundant alt text.
 */
export function CardThumbnail({
  card,
  size = 28,
}: {
  card: WebCardView;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const url = scryfallImageUrl(card, 'art_crop');
  if (failed || !url) return null;
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      data-testid="card-thumbnail"
      className="rounded-sm object-cover shrink-0"
      style={{ width: size, height: size }}
    />
  );
}
