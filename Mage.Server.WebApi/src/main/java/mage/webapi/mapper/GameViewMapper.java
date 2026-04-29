package mage.webapi.mapper;

import mage.choices.Choice;
import mage.game.events.PlayerQueryEvent;
import mage.view.AbilityPickerView;
import mage.view.CombatGroupView;
import mage.view.CommandObjectView;
import mage.view.CommanderView;
import mage.view.DungeonView;
import mage.view.EmblemView;
import mage.view.GameClientMessage;
import mage.view.GameEndView;
import mage.view.GameView;
import mage.view.ManaPoolView;
import mage.view.PlaneView;
import mage.view.PlayerView;
import mage.view.TableClientMessage;
import mage.webapi.dto.stream.WebAbilityPickerView;
import mage.webapi.dto.stream.WebChoice;
import mage.webapi.dto.stream.WebClientMessageOptions;
import mage.webapi.dto.stream.WebCombatGroupView;
import mage.webapi.dto.stream.WebCommandObjectView;
import mage.webapi.dto.stream.WebGameClientMessage;
import mage.webapi.dto.stream.WebGameEndView;
import mage.webapi.dto.stream.WebGameView;
import mage.webapi.dto.stream.WebManaPoolView;
import mage.webapi.dto.stream.WebPlayerView;
import mage.webapi.dto.stream.WebStartGameInfo;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Maps upstream game-state views to wire DTOs.
 *
 * <ul>
 *   <li>{@link GameView} → {@link WebGameView} — top-level scalars,
 *       per-player summaries, controlling-player hand (slice 4),
 *       stack + combat (slice 5).</li>
 *   <li>{@link PlayerView} → {@link WebPlayerView} — life / counts /
 *       mana pool / state flags + battlefield (slice 4) + graveyard
 *       / exile / sideboard maps (slice 5).</li>
 *   <li>{@link ManaPoolView} → {@link WebManaPoolView} — six color
 *       buckets.</li>
 *   <li>{@link TableClientMessage} → {@link WebStartGameInfo} — the
 *       slim subset populated by {@code ccGameStarted}.</li>
 *   <li>{@link GameClientMessage} → {@link WebGameClientMessage} —
 *       wrapper for {@code gameInform} / {@code gameOver} (slice 5).</li>
 *   <li>{@link GameEndView} → {@link WebGameEndView} — match-end
 *       summary for {@code endGameInfo} (slice 5).</li>
 * </ul>
 *
 * <p>Pure record-to-record translation. Defensive on null fields so
 * an in-flight engine state with partial data can still serialize.
 */
public final class GameViewMapper {

    private GameViewMapper() {
    }

    public static WebGameView toDto(GameView gv) {
        return toDto(gv, Map.of());
    }

    /**
     * Slice 52a overload accepting a stack-cardId hint
     * (built by {@link mage.webapi.upstream.StackCardIdHint}). The
     * hint maps each stack-entry's {@code SpellAbility} UUID to the
     * underlying physical {@code Card} UUID so the webclient can use
     * {@code WebCardView.cardId} as a Framer Motion {@code layoutId}
     * for cross-zone animation. {@link Map#of()} (no hint) is
     * acceptable — every stack entry's {@code cardId} then falls
     * back to its {@code id}, which is the pre-slice-52a behavior.
     */
    public static WebGameView toDto(GameView gv, Map<UUID, UUID> stackCardIdHint) {
        if (gv == null) {
            throw new IllegalArgumentException("GameView must not be null");
        }
        List<WebPlayerView> players = new ArrayList<>(gv.getPlayers().size());
        for (PlayerView pv : gv.getPlayers()) {
            players.add(toPlayerDto(pv));
        }
        PlayerView me = gv.getMyPlayer();
        String myPlayerId = (me == null || me.getPlayerId() == null)
                ? "" : me.getPlayerId().toString();

        List<WebCombatGroupView> combat;
        if (gv.getCombat() == null || gv.getCombat().isEmpty()) {
            combat = List.of();
        } else {
            combat = new ArrayList<>(gv.getCombat().size());
            for (CombatGroupView cg : gv.getCombat()) {
                if (cg != null) combat.add(CombatGroupMapper.toDto(cg));
            }
        }

        Map<UUID, UUID> hint = stackCardIdHint == null ? Map.of() : stackCardIdHint;

        return new WebGameView(
                gv.getTurn(),
                gv.getPhase() == null ? "" : gv.getPhase().name(),
                gv.getStep() == null ? "" : gv.getStep().name(),
                nullToEmpty(gv.getActivePlayerName()),
                nullToEmpty(gv.getPriorityPlayerName()),
                gv.getSpecial(),
                gv.isRollbackTurnsAllowed(),
                gv.getTotalErrorsCount(),
                gv.getTotalEffectsCount(),
                gv.getGameCycle(),
                myPlayerId,
                CardViewMapper.toCardMap(gv.getMyHand()),
                CardViewMapper.toStackMap(gv.getStack(), hint),
                combat,
                players
        );
    }

    public static WebPlayerView toPlayerDto(PlayerView pv) {
        if (pv == null) {
            throw new IllegalArgumentException("PlayerView must not be null");
        }
        return new WebPlayerView(
                pv.getPlayerId() == null ? "" : pv.getPlayerId().toString(),
                nullToEmpty(pv.getName()),
                pv.getLife(),
                pv.getWins(),
                pv.getWinsNeeded(),
                pv.getLibraryCount(),
                pv.getHandCount(),
                CardViewMapper.toCardMap(pv.getGraveyard()),
                CardViewMapper.toCardMap(pv.getExile()),
                CardViewMapper.toCardMap(pv.getSideboard()),
                CardViewMapper.toPermanentMap(pv.getBattlefield()),
                toManaPoolDto(pv.getManaPool()),
                pv.getControlled(),
                pv.isHuman(),
                pv.isActive(),
                pv.hasPriority(),
                pv.hasLeft(),
                pv.isMonarch(),
                pv.isInitiative(),
                pv.getDesignationNames() == null
                        ? List.of()
                        : List.copyOf(pv.getDesignationNames()),
                toCommandList(pv.getCommandObjectList()),
                // Slice 69a — schema 1.20 wire shape ships null. Slice
                // 69b derives from MatchType.getPlayersPerTeam() +
                // seat-index once live-game lookup is plumbed through
                // the mapper (ADR 0010 v2 D3a + R1).
                null
        );
    }

    /**
     * Map the upstream {@code CommandObjectView} interface (4 concrete
     * subclasses) into a flat list of {@link WebCommandObjectView}
     * records with a {@code kind} discriminator. Empty input → empty
     * output (never null) so the wire format is stable across the
     * common no-commander 1v1 case.
     */
    static List<WebCommandObjectView> toCommandList(List<CommandObjectView> source) {
        if (source == null || source.isEmpty()) {
            return List.of();
        }
        List<WebCommandObjectView> out = new ArrayList<>(source.size());
        for (CommandObjectView co : source) {
            if (co == null) {
                continue;
            }
            out.add(toCommandObjectDto(co));
        }
        return List.copyOf(out);
    }

    static WebCommandObjectView toCommandObjectDto(CommandObjectView co) {
        return new WebCommandObjectView(
                co.getId() == null ? "" : co.getId().toString(),
                kindFor(co),
                nullToEmpty(co.getName()),
                nullToEmpty(co.getExpansionSetCode()),
                nullToEmpty(co.getImageFileName()),
                co.getImageNumber(),
                co.getRules() == null ? List.of() : List.copyOf(co.getRules())
        );
    }

    private static String kindFor(CommandObjectView co) {
        // CommanderView extends CardView, so it must be checked
        // before any superclass assumptions; the rest are flat
        // implementations of the interface. Default lands as
        // commander rather than throwing — forward-compat for any
        // fifth subclass upstream may add later (better to render
        // as a card than to drop the entry).
        if (co instanceof CommanderView) return "commander";
        if (co instanceof EmblemView) return "emblem";
        if (co instanceof DungeonView) return "dungeon";
        if (co instanceof PlaneView) return "plane";
        return "commander";
    }

    public static WebManaPoolView toManaPoolDto(ManaPoolView mp) {
        if (mp == null) {
            return new WebManaPoolView(0, 0, 0, 0, 0, 0);
        }
        return new WebManaPoolView(
                mp.getRed(),
                mp.getGreen(),
                mp.getBlue(),
                mp.getWhite(),
                mp.getBlack(),
                mp.getColorless()
        );
    }

    public static WebStartGameInfo toStartGameInfo(TableClientMessage tcm) {
        if (tcm == null) {
            throw new IllegalArgumentException("TableClientMessage must not be null");
        }
        return new WebStartGameInfo(
                tcm.getCurrentTableId() == null ? "" : tcm.getCurrentTableId().toString(),
                tcm.getGameId() == null ? "" : tcm.getGameId().toString(),
                tcm.getPlayerId() == null ? "" : tcm.getPlayerId().toString()
        );
    }

    public static WebGameClientMessage toClientMessage(GameClientMessage gcm) {
        if (gcm == null) {
            throw new IllegalArgumentException("GameClientMessage must not be null");
        }
        WebGameView wrapped = gcm.getGameView() == null ? null : toDto(gcm.getGameView());
        List<String> targets;
        if (gcm.getTargets() == null || gcm.getTargets().isEmpty()) {
            targets = List.of();
        } else {
            targets = new ArrayList<>(gcm.getTargets().size());
            for (UUID id : gcm.getTargets()) {
                if (id != null) targets.add(id.toString());
            }
        }
        WebChoice choice = gcm.getChoice() == null ? null : toChoiceDto(gcm.getChoice());
        return new WebGameClientMessage(
                wrapped,
                nullToEmpty(gcm.getMessage()),
                targets,
                CardViewMapper.toCardMap(gcm.getCardsView1()),
                gcm.getMin(),
                gcm.getMax(),
                gcm.isFlag(),
                choice,
                extractOptions(gcm.getOptions())
        );
    }

    /**
     * Synthesize a {@link WebGameClientMessage} carrying only an error
     * message text. Used for the {@code gameError} frame, whose
     * upstream {@code GAME_ERROR} callback carries a bare String
     * instead of a {@code GameClientMessage}.
     */
    public static WebGameClientMessage toErrorMessage(String text) {
        return new WebGameClientMessage(
                null,
                text == null ? "" : text,
                List.of(),
                Map.of(),
                0,
                0,
                false,
                null,
                WebClientMessageOptions.EMPTY
        );
    }

    /**
     * Project upstream's free-form {@code options} map onto our
     * whitelisted {@link WebClientMessageOptions} record. Five keys
     * forwarded today (slice 17 covers button-text overrides; slice
     * 20 will populate combat fields):
     *
     * <ul>
     *   <li>{@code "UI.left.btn.text"} / {@code "UI.right.btn.text"}
     *       — button-label overrides for {@code gameAsk} (mulligan
     *       uses these to render "Mulligan" / "Keep").</li>
     *   <li>{@code "POSSIBLE_ATTACKERS"} / {@code "POSSIBLE_BLOCKERS"}
     *       — UUID lists (List&lt;UUID&gt; in upstream).</li>
     *   <li>{@code "SPECIAL_BUTTON"} — text for the "All attack"
     *       button.</li>
     * </ul>
     *
     * <p>Anything else upstream stuffs into the map is dropped on the
     * floor — the wire format is a closed surface, not a passthrough.
     */
    static WebClientMessageOptions extractOptions(
            java.util.Map<String, java.io.Serializable> source) {
        if (source == null || source.isEmpty()) {
            return WebClientMessageOptions.EMPTY;
        }
        return new WebClientMessageOptions(
                stringValue(source.get("UI.left.btn.text")),
                stringValue(source.get("UI.right.btn.text")),
                uuidList(source.get("POSSIBLE_ATTACKERS")),
                uuidList(source.get("POSSIBLE_BLOCKERS")),
                stringValue(source.get("SPECIAL_BUTTON")),
                source.get("queryType") == PlayerQueryEvent.QueryType.PICK_ABILITY
        );
    }

    private static String stringValue(Object v) {
        return v instanceof String s ? s : "";
    }

    @SuppressWarnings("unchecked")
    private static List<String> uuidList(Object v) {
        if (!(v instanceof java.util.Collection<?> coll) || coll.isEmpty()) {
            return List.of();
        }
        List<String> out = new ArrayList<>(coll.size());
        for (Object item : coll) {
            if (item instanceof UUID id) {
                out.add(id.toString());
            } else if (item instanceof String s) {
                out.add(s);
            }
        }
        return List.copyOf(out);
    }

    /**
     * Map upstream {@link Choice} to the wire-format {@link WebChoice}.
     * Flattens upstream's {@code getChoices(): Set<String>} +
     * {@code getKeyChoices(): Map<String, String>} into a single
     * {@code Map<String, String>} — when upstream is in non-key mode
     * the synthesized map uses {@code key == label}.
     */
    public static WebChoice toChoiceDto(Choice c) {
        if (c == null) {
            throw new IllegalArgumentException("Choice must not be null");
        }
        Map<String, String> choices;
        if (c.isKeyChoice() && c.getKeyChoices() != null) {
            choices = new LinkedHashMap<>(c.getKeyChoices().size());
            c.getKeyChoices().forEach((k, v) -> {
                if (k != null) {
                    choices.put(k, v == null ? k : v);
                }
            });
        } else if (c.getChoices() != null) {
            choices = new LinkedHashMap<>(c.getChoices().size());
            for (String entry : c.getChoices()) {
                if (entry != null) choices.put(entry, entry);
            }
        } else {
            choices = Map.of();
        }
        return new WebChoice(
                nullToEmpty(c.getMessage()),
                nullToEmpty(c.getSubMessage()),
                c.isRequired(),
                choices
        );
    }

    /**
     * Map upstream {@link AbilityPickerView} to the wire-format
     * {@link WebAbilityPickerView}. Carries the embedded {@code GameView}
     * (recursively mapped) plus the picker-specific message + choices
     * map. Insertion order from upstream's {@code LinkedHashMap} is
     * preserved.
     */
    public static WebAbilityPickerView toAbilityPickerDto(AbilityPickerView apv) {
        if (apv == null) {
            throw new IllegalArgumentException("AbilityPickerView must not be null");
        }
        WebGameView wrapped = apv.getGameView() == null ? null : toDto(apv.getGameView());
        Map<String, String> choices;
        if (apv.getChoices() == null || apv.getChoices().isEmpty()) {
            choices = Map.of();
        } else {
            choices = new LinkedHashMap<>(apv.getChoices().size());
            apv.getChoices().forEach((k, v) -> {
                if (k != null) {
                    choices.put(k.toString(), v == null ? "" : v);
                }
            });
        }
        return new WebAbilityPickerView(
                wrapped,
                nullToEmpty(apv.getMessage()),
                choices
        );
    }

    public static WebGameEndView toGameEndDto(GameEndView gev) {
        if (gev == null) {
            throw new IllegalArgumentException("GameEndView must not be null");
        }
        List<WebPlayerView> players;
        if (gev.getPlayers() == null || gev.getPlayers().isEmpty()) {
            players = List.of();
        } else {
            players = new ArrayList<>(gev.getPlayers().size());
            for (PlayerView pv : gev.getPlayers()) {
                if (pv != null) players.add(toPlayerDto(pv));
            }
        }
        return new WebGameEndView(
                nullToEmpty(gev.getGameInfo()),
                nullToEmpty(gev.getMatchInfo()),
                nullToEmpty(gev.getAdditionalInfo()),
                gev.hasWon(),
                gev.getWins(),
                gev.getWinsNeeded(),
                players
        );
    }

    private static String nullToEmpty(String s) {
        return s == null ? "" : s;
    }
}
