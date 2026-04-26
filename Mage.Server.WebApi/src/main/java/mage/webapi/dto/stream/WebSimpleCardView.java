package mage.webapi.dto.stream;

/**
 * Slim card record used in deck-construction wire payloads (sideboard
 * picker, draft constructing later). Mirrors upstream
 * {@code mage.view.SimpleCardView} but adds a server-side-resolved
 * {@code name} so the webclient doesn't need a card-database round
 * trip to render the picker.
 *
 * <p>Why a slim record and not {@link WebCardView}: SimpleCardView
 * contains only the print-identifying tuple (set/number) plus the
 * per-instance UUID. Game-state fields like {@code typeLine},
 * {@code rules}, {@code power}/{@code toughness}, etc. are unknown at
 * deck-construction time and would just be empty strings.
 *
 * @param id                 per-instance UUID
 * @param name               resolved card name (via
 *     {@code CardRepository.findCard(setCode, cardNumber)}). Falls
 *     back to {@code "<set>:<number>"} if lookup fails — never null.
 * @param expansionSetCode   set code (e.g. {@code "DOM"})
 * @param cardNumber         collector number
 * @param usesVariousArt     true for cards with multiple-art prints
 *     (basic lands, fan favorites). The webclient may pick a
 *     specific art version when this is true.
 */
public record WebSimpleCardView(
        String id,
        String name,
        String expansionSetCode,
        String cardNumber,
        boolean usesVariousArt
) {
}
