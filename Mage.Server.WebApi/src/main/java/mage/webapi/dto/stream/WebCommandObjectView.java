package mage.webapi.dto.stream;

import java.util.List;

/**
 * One entry in {@link WebPlayerView#commandList()} — a card-like
 * object that lives in the command zone.
 *
 * <p>Upstream models the command zone via the
 * {@code mage.view.CommandObjectView} interface, with four concrete
 * implementations: {@code CommanderView} (the actual commander card),
 * {@code EmblemView} (planeswalker emblems), {@code DungeonView}
 * (D&D-style dungeons), and {@code PlaneView} (Planechase planes).
 * The wire format collapses all four into this single record with a
 * {@code kind} discriminator so the webclient can render an
 * appropriate placeholder per kind without having to keep four
 * parallel DTOs.
 *
 * <p>Slice 11 ships the metadata shape (id, name, set/image hints,
 * rules text) — enough to render a labelled placeholder. Future
 * slices may extend with full {@link WebCardView} for {@code commander}
 * entries when card art lookup is wired.
 *
 * @param id                  upstream UUID of the command object
 * @param kind                discriminator: {@code commander},
 *     {@code emblem}, {@code dungeon}, or {@code plane}. Defaults to
 *     {@code commander} for unknown subclasses (forward-compat — better
 *     to render as a card than to drop it).
 * @param name                display name (e.g. "Atraxa, Praetors' Voice")
 * @param expansionSetCode    set code, may be empty
 * @param imageFileName       art-lookup hint, may be empty
 * @param imageNumber         art-variant number from upstream
 *     {@code MageObject.imageNumber}. ZERO for ordinary cards —
 *     xmage only populates this for tokens / face-down stand-ins
 *     (verified empirically). For commander art lookup, prefer
 *     {@link #cardNumber} (the collector number string from the
 *     card's set registration).
 * @param cardNumber          collector number (string, may carry
 *     non-digit suffixes like "281a"). Set from
 *     {@code Card.getCardNumber()}; this is what xmage actually
 *     populates for ordinary cards and what Scryfall uses in its
 *     {@code /cards/{set}/{collector_number}} endpoint.
 * @param rules               rules text lines (empty list if upstream
 *     produced none — never null)
 */
public record WebCommandObjectView(
        String id,
        String kind,
        String name,
        String expansionSetCode,
        String imageFileName,
        int imageNumber,
        String cardNumber,
        List<String> rules
) {
}
