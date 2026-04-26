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
 * @param imageNumber         art number, 0 if unknown
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
        List<String> rules
) {
}
