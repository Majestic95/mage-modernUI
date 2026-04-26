package mage.webapi.dto.stream;

import java.util.List;

/**
 * Battlefield permanent. Composes {@link WebCardView} (the printed-card
 * data) with the runtime state that's only meaningful while the
 * permanent is in play.
 *
 * <p>Per ADR 0007 D7a the upstream {@code PermanentView} extends
 * {@code CardView}; the wire format expresses that as composition
 * because Java records cannot extend, and a flat denormalized record
 * would duplicate every {@link WebCardView} field on every permanent
 * — bloating both wire size and the webclient Zod schema.
 *
 * <p>Combat state ({@code attacking} / {@code blocking}) is deferred to
 * slice 5 alongside {@code WebCombatGroupView}; clients can already
 * derive "creature on battlefield" from the card-type bits.
 *
 * @param card               the underlying card snapshot
 * @param controllerName     player who currently controls this
 *     permanent (may differ from owner — e.g. {@code Threaten})
 * @param tapped             true while turned 90°
 * @param flipped            true if this is a flipped flip-card
 *     ({@code Akki Lavarunner} ↔ {@code Tok-Tok}); upstream
 *     {@code transformed} on a flip-card encodes the flip state, but
 *     we expose both bits separately for clarity
 * @param transformed        true if this is the back face of a
 *     transformable card
 * @param phasedIn           true if currently phased in (false ⇒
 *     phased out, treated as not on the battlefield by most rules)
 * @param summoningSickness  true while affected by the standard
 *     summoning-sickness rule (interacts with haste)
 * @param damage             marked damage on creatures
 * @param attachments        IDs of equipment / auras / counters
 *     attached to this permanent
 * @param attachedTo         the UUID this permanent is attached to
 *     (equipment / aura target), or empty if not attached. May
 *     reference either a permanent or a player — see
 *     {@code attachedToPermanent} to disambiguate.
 * @param attachedToPermanent true when {@code attachedTo} references
 *     a permanent on the battlefield. False when it references a
 *     player (player-targeting auras like Curse-of-Bloodletting), or
 *     when {@code attachedTo} is empty. Mirrors upstream
 *     {@code mage.view.PermanentView.attachedToPermanent}.
 */
public record WebPermanentView(
        WebCardView card,
        String controllerName,
        boolean tapped,
        boolean flipped,
        boolean transformed,
        boolean phasedIn,
        boolean summoningSickness,
        int damage,
        List<String> attachments,
        String attachedTo,
        boolean attachedToPermanent
) {
}
