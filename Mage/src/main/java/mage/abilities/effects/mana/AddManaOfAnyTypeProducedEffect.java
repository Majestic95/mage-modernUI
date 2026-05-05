package mage.abilities.effects.mana;

import mage.Mana;
import mage.abilities.Ability;
import mage.abilities.mana.ActivatedManaAbilityImpl;
import mage.choices.Choice;
import mage.choices.ChoiceColor;
import mage.constants.Zone;
import mage.game.Game;
import mage.game.permanent.Permanent;
import mage.players.Player;

import java.util.ArrayList;
import java.util.List;

/**
 * @author LevelX2
 */
public class AddManaOfAnyTypeProducedEffect extends ManaEffect {

    public AddManaOfAnyTypeProducedEffect() {
        super();
        staticText = "that player adds one mana of any type that land produced";
    }

    protected AddManaOfAnyTypeProducedEffect(final AddManaOfAnyTypeProducedEffect effect) {
        super(effect);
    }

    @Override
    public Player getPlayer(Game game, Ability source) {
        Permanent permanent = (Permanent) getValue("tappedPermanent");
        if (permanent != null) {
            return game.getPlayer(permanent.getControllerId());
        }
        return null;
    }

    @Override
    public List<Mana> getNetMana(Game game, Ability source) {
        List<Mana> netMana = new ArrayList<>();
        Mana types = (Mana) this.getValue("mana");
        if (types == null) {
            return netMana;
        }
        if (types.getBlack() > 0) {
            netMana.add(Mana.BlackMana(1));
        }
        if (types.getRed() > 0) {
            netMana.add(Mana.RedMana(1));
        }
        if (types.getBlue() > 0) {
            netMana.add(Mana.BlueMana(1));
        }
        if (types.getGreen() > 0) {
            netMana.add(Mana.GreenMana(1));
        }
        if (types.getWhite() > 0) {
            netMana.add(Mana.WhiteMana(1));
        }
        if (types.getColorless() > 0) {
            netMana.add(Mana.ColorlessMana(1));
        }
        return netMana;
    }

    @Override
    public Mana produceMana(Game game, Ability source) {
        Mana newMana = new Mana();
        if (game == null) {
            return newMana;
        }
        Permanent permanent = (Permanent) this.getValue("tappedPermanent");
        Mana types = (Mana) this.getValue("mana");
        if (permanent == null || types == null) {
            return newMana;
        }
        Player targetController = game.getPlayer(permanent.getControllerId());
        if (targetController == null) {
            return newMana;
        }

        // FB#3 (2026-05-05) — Mirari's Wake (and 15 sibling cards using
        // this effect: Mana Flare, Heartbeat of Spring, Vorinclex Voice
        // of Hunger, Zhur-Taa Ancient, Zendikar Resurgent, Roxanne
        // Starfall Savant, Overabundance, Nikya of the Old Ways,
        // Lavaleaper, Kinnan Bonder Prodigy, Keeper of Progenitus,
        // Extraplanar Lens, Dictate of Karametra, Barbflare Gremlin,
        // Winters Night) all carry the oracle text "add one mana of
        // any type that land produced." User direction 2026-05-05:
        // when a dual land is tapped for one color, the trigger should
        // present the choice over BOTH colors the land could produce,
        // not auto-add the same color. Pre-fix, tapping a Tundra for
        // {W} caused the trigger to auto-add {W} (only one option in
        // `types`); now it offers {W} + {U} for the player to pick.
        // Basic lands and single-color lands still auto-pick (only one
        // type in the union).
        //
        // Implementation: the choice set is the union of every
        // activated mana ability's getNetMana() on the permanent at
        // the time of resolution. Falls back to `types` (the single
        // tap output) if the permanent has lost all mana abilities by
        // resolution time, so the bonus mana is never wiped entirely.
        //
        // Implementation note for upstream-rebase: this block diverges
        // from upstream/master's "build choices from `types`" pattern
        // intentionally per user direction. Preserve the union-over-
        // mana-abilities approach when merging.
        Mana availableTypes = new Mana();
        for (ActivatedManaAbilityImpl manaAbility :
                permanent.getAbilities(game).getActivatedManaAbilities(Zone.BATTLEFIELD)) {
            for (Mana possible : manaAbility.getNetMana(game)) {
                if (possible.getWhite() > 0) availableTypes.setWhite(1);
                if (possible.getBlue() > 0) availableTypes.setBlue(1);
                if (possible.getBlack() > 0) availableTypes.setBlack(1);
                if (possible.getRed() > 0) availableTypes.setRed(1);
                if (possible.getGreen() > 0) availableTypes.setGreen(1);
                if (possible.getColorless() > 0) availableTypes.setColorless(1);
                if (possible.getAny() > 0) {
                    // "Any color" lands (e.g., Forbidden Orchard,
                    // Gemstone Caverns with luck counter) — the choice
                    // covers all five colors.
                    availableTypes.setWhite(1);
                    availableTypes.setBlue(1);
                    availableTypes.setBlack(1);
                    availableTypes.setRed(1);
                    availableTypes.setGreen(1);
                }
            }
        }
        // Defensive: if the permanent has lost all mana abilities by
        // the time the trigger resolves, fall back to the single
        // type that was actually produced so we don't wipe the
        // bonus mana entirely.
        if (availableTypes.count() == 0) {
            availableTypes = types.copy();
        }

        Choice choice = new ChoiceColor(true);
        choice.getChoices().clear();
        choice.setMessage("Pick the type of mana to produce");
        if (availableTypes.getWhite() > 0) {
            choice.getChoices().add("White");
        }
        if (availableTypes.getBlue() > 0) {
            choice.getChoices().add("Blue");
        }
        if (availableTypes.getBlack() > 0) {
            choice.getChoices().add("Black");
        }
        if (availableTypes.getRed() > 0) {
            choice.getChoices().add("Red");
        }
        if (availableTypes.getGreen() > 0) {
            choice.getChoices().add("Green");
        }
        if (availableTypes.getColorless() > 0) {
            choice.getChoices().add("Colorless");
        }

        switch (choice.getChoices().size()) {
            case 0: // no mana possible to add
                return newMana;
            case 1: // no choice necessary for one option
                choice.setChoice(choice.getChoices().iterator().next());
                break;
            default:
                // attempt to make choice
                if (!targetController.choose(outcome, choice, game)) {
                    return newMana; // no mana if no choice made
                }
        }

        switch (choice.getChoice()) {
            case "White":
                newMana.setWhite(1);
                break;
            case "Blue":
                newMana.setBlue(1);
                break;
            case "Black":
                newMana.setBlack(1);
                break;
            case "Red":
                newMana.setRed(1);
                break;
            case "Green":
                newMana.setGreen(1);
                break;
            case "Colorless":
                newMana.setColorless(1);
                break;
            default:
        }
        return newMana;
    }

    @Override
    public AddManaOfAnyTypeProducedEffect copy() {
        return new AddManaOfAnyTypeProducedEffect(this);
    }
}
