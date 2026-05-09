import { useEffect, useState } from 'react';
import type { WebDeckCardInfo } from '../api/schemas';

interface Props {
  displayCard: WebDeckCardInfo | null;
}

/**
 * Discovery hint for the per-deck "display card" lobby portrait.
 *
 * <p>The displayCard wire field controls what art appears for this seat
 * in the lobby ready-up screen for non-Commander formats (Pauper,
 * Standard, etc.). The picker itself lives on each card row's "Display"
 * button — but that button is one of dozens on the page and easy to
 * miss. This summary surfaces the current pick (or the fact that none
 * is set) at the top of the editor, so users know the feature exists
 * and can see what they currently have selected without scrolling.
 *
 * <p>Read-only display: no controls live here. Changing the pick still
 * goes through the per-row "Display" button so the existing test surface
 * and audit-locked accessibility on that affordance keep applying. This
 * component is purely a passive surface for "what is currently set".
 *
 * <p>Commander format note: the wire-side priority always picks
 * commander art over displayCard when both are present
 * (see TableMapper#seat). Users with a commander deck can still pick
 * a displayCard and the per-row pill will reflect it, but the lobby
 * seat will show commander art at table-join time. The empty-state
 * copy mentions this so users don't think they "broke" their portrait
 * by leaving displayCard unset on a Commander deck.
 */
export function LobbyPortraitSummary({ displayCard }: Props) {
  const [imgFailed, setImgFailed] = useState(false);
  // Reset on prop change so a one-time Scryfall 404 on card A doesn't
  // keep the placeholder rendered when the user picks a different
  // card B with valid art. Without this, the component instance
  // persists `imgFailed=true` across re-renders.
  useEffect(() => {
    setImgFailed(false);
  }, [displayCard?.cardName, displayCard?.setCode, displayCard?.cardNumber]);
  if (!displayCard) {
    return (
      <div
        data-testid="lobby-portrait-summary"
        data-state="empty"
        className="flex items-start gap-3 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2"
      >
        <div
          aria-hidden="true"
          className="h-12 w-12 flex-shrink-0 rounded bg-zinc-800"
        />
        <div className="min-w-0 flex-1 leading-snug">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Lobby portrait
          </p>
          <p className="text-sm text-zinc-300">
            No card chosen.{' '}
            <span className="text-zinc-400">
              Click <strong className="text-zinc-200">Display</strong> on any
              card row below to use it as your seat portrait in non-Commander
              formats. Commander decks use commander art automatically.
            </span>
          </p>
        </div>
      </div>
    );
  }
  const artUrl = scryfallArtCropUrl(displayCard.setCode, displayCard.cardNumber);
  return (
    <div
      data-testid="lobby-portrait-summary"
      data-state="set"
      data-card-name={displayCard.cardName}
      className="flex items-start gap-3 rounded-md border border-fuchsia-900/60 bg-zinc-900/60 px-3 py-2"
    >
      <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded bg-zinc-800">
        {artUrl && !imgFailed ? (
          <img
            src={artUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          />
        ) : null}
      </div>
      <div className="min-w-0 flex-1 leading-snug">
        <p className="text-xs font-semibold uppercase tracking-wide text-fuchsia-300">
          Lobby portrait
        </p>
        <p className="truncate text-sm text-zinc-100" title={displayCard.cardName}>
          {displayCard.cardName}
        </p>
        <p className="text-xs text-zinc-400">
          Click <strong className="text-zinc-200">Display</strong> on a different
          card row below to change. Commander art always wins when present.
        </p>
      </div>
    </div>
  );
}

function scryfallArtCropUrl(
  setCode: string,
  cardNumber: string,
): string | null {
  if (!setCode || !cardNumber) return null;
  const set = setCode.toLowerCase();
  const num = encodeURIComponent(cardNumber);
  return `https://api.scryfall.com/cards/${set}/${num}?format=image&version=art_crop`;
}
