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
import mage.webapi.dto.stream.WebCardView;
import mage.webapi.dto.stream.WebManaPoolView;
import mage.webapi.dto.stream.WebMultiAmountInfo;
import mage.webapi.dto.stream.WebMultiAmountRow;
import mage.webapi.dto.stream.WebPlayerView;
import mage.webapi.dto.stream.WebStartGameInfo;
import mage.webapi.upstream.MultiplayerFrameContext;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
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
        return toDto(gv, stackCardIdHint, MultiplayerFrameContext.EMPTY, null);
    }

    /**
     * Slice 69c — full overload accepting both the stack-cardId hint
     * and the multiplayer frame context (ADR 0010 v2 D1, D3c). Used
     * by {@code WebSocketCallbackHandler.mapGameView} on the
     * production callback path; tests + {@code GameClientMessage}
     * mappers fall through the simpler overloads above.
     *
     * @param mpCtx          per-frame goading + (future) team data
     *                       derived from live {@code Game}. Pass
     *                       {@link MultiplayerFrameContext#EMPTY}
     *                       when no live-game reference is available.
     * @param playersInRange D1 RoI filter — stringified player UUIDs
     *                       visible to the recipient. {@code null}
     *                       means no filter (RoI.ALL or unknown
     *                       recipient — the full roster goes on the
     *                       wire). Non-null means filter
     *                       {@code gv.getPlayers()} to this set
     *                       per-recipient before mapping.
     */
    public static WebGameView toDto(
            GameView gv,
            Map<UUID, UUID> stackCardIdHint,
            MultiplayerFrameContext mpCtx,
            Set<UUID> playersInRange) {
        if (gv == null) {
            throw new IllegalArgumentException("GameView must not be null");
        }
        MultiplayerFrameContext effectiveMpCtx =
                mpCtx == null ? MultiplayerFrameContext.EMPTY : mpCtx;
        List<WebPlayerView> players = new ArrayList<>(gv.getPlayers().size());
        for (PlayerView pv : gv.getPlayers()) {
            // Slice 69c — D1 range-of-influence filter. Drop players
            // whose UUID is not in the recipient's in-range set.
            // Iteration order from upstream's LinkedHashMap is
            // preserved for the survivors so turn-order stays stable
            // on the wire (Battlefield's clockwise tab order in 69b
            // depends on this).
            if (!shouldIncludePlayer(pv.getPlayerId(), playersInRange)) {
                continue;
            }
            players.add(toPlayerDto(pv, effectiveMpCtx));
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

    /**
     * Slice 69c (ADR 0010 v2 D1) — predicate for the range-of-influence
     * filter applied to {@code WebGameView.players}. Package-private
     * so unit tests can lock the contract directly without the
     * impractical-to-mock {@code GameView} constructor chain.
     *
     * <p>Semantics:
     * <ul>
     *   <li>{@code playersInRange == null} → "no filter" (RoI.ALL or
     *       unknown recipient — the full roster goes on the wire).
     *       Returns {@code true} for every input.</li>
     *   <li>{@code playerId == null} → defensive keep (a malformed
     *       PlayerView shouldn't crash the frame; the survivor's
     *       {@code playerId} field will be empty-string downstream).
     *       Returns {@code true}.</li>
     *   <li>Both non-null → {@code true} iff {@code playerId} is in
     *       the in-range set, {@code false} otherwise (drop the
     *       PlayerView entry from the wire).</li>
     * </ul>
     *
     * <p>Filter location is the WebApi mapper, not the upstream
     * {@code GameView} constructor — upstream's
     * {@code GameView(state, game, recipientId, watcherId)} iterates
     * the full {@code state.getPlayers()} roster regardless of RoI
     * (verified at {@code Mage.Common/.../GameView.java:77}). The
     * mapper-time drop is the only place to filter without patching
     * upstream; semantics are equivalent for security purposes
     * because the data we filter on (recipient's {@code Player.getRange()}
     * + {@code GameState.getPlayersInRange()}) is exactly what the
     * engine would have used at construction time.
     */
    static boolean shouldIncludePlayer(UUID playerId, Set<UUID> playersInRange) {
        if (playersInRange == null) {
            return true;
        }
        if (playerId == null) {
            return true;
        }
        return playersInRange.contains(playerId);
    }

    public static WebPlayerView toPlayerDto(PlayerView pv) {
        return toPlayerDto(pv, MultiplayerFrameContext.EMPTY);
    }

    /**
     * Slice 69c — overload threading the multiplayer frame context to
     * the per-permanent mapper so each player's battlefield carries
     * populated {@code goadingPlayerIds} when the context is
     * non-empty (ADR 0010 v2 D3c). Pass
     * {@link MultiplayerFrameContext#EMPTY} for the legacy / test
     * path.
     *
     * <p>{@code teamId} stays {@code null} per ADR R1 (slice 69c
     * empirical finding): xmage upstream ships no 2HG match plugin,
     * so no game produces team-grouped state. The schema-1.20
     * {@code teamId} wire field is forward-compat for a v3+ ADR if
     * upstream ever adds a 2HG plugin.
     */
    public static WebPlayerView toPlayerDto(PlayerView pv, MultiplayerFrameContext mpCtx) {
        if (pv == null) {
            throw new IllegalArgumentException("PlayerView must not be null");
        }
        MultiplayerFrameContext effective = mpCtx == null ? MultiplayerFrameContext.EMPTY : mpCtx;
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
                CardViewMapper.toPermanentMap(pv.getBattlefield(), effective),
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
                // teamId — null per ADR R1 (slice 69c finding). No
                // shipped match type produces team-grouped state in
                // upstream xmage. Forward-compat wire shape only.
                null,
                // Slice 70-D (ADR 0011 D5) — colorIdentity drives the
                // PlayerFrame halo. Empty list for non-commander
                // formats; for commander formats the union of every
                // commander's color identity (handles partner /
                // background pairings).
                deriveColorIdentity(pv.getCommandObjectList()),
                // Slice 70-H (ADR 0011 D3 / ADR 0010 v2 D11(e)) —
                // connectionState drives the PlayerFrame
                // DISCONNECTED overlay. Resolved via the tracker
                // bundled in MultiplayerFrameContext (production
                // path: WebSocketCallbackHandler.mapGameView builds
                // a route-filtered socket-count oracle around
                // AuthService; test / legacy path: EVERY_PLAYER_CONNECTED).
                effective.connectionStateFor(pv.getPlayerId())
        );
    }

    /**
     * Slice 70-D — extract the union color identity from the player's
     * command zone. Iterates {@link CommanderView} entries (skipping
     * emblems, dungeons, planes) and unions their
     * {@code getOriginalColorIdentity()} strings.
     *
     * <p>Non-commander formats produce {@link List#of()} (no
     * {@code CommanderView} entries → empty union). Critic N9 — emit
     * {@code List.of()} not {@code null}; the client's Zod default
     * fires only on a missing JSON key, not on a literal {@code null}.
     */
    static List<String> deriveColorIdentity(List<CommandObjectView> commandList) {
        if (commandList == null || commandList.isEmpty()) {
            return List.of();
        }
        List<String> commanderIdentities = new ArrayList<>();
        for (CommandObjectView co : commandList) {
            if (co instanceof CommanderView cv) {
                commanderIdentities.add(cv.getOriginalColorIdentity());
            }
        }
        return unionColorIdentity(commanderIdentities);
    }

    /**
     * Slice 70-D — pure string-processing helper. Takes a list of
     * upstream-format color-identity strings (e.g. {@code "WU"},
     * {@code "BG"}, {@code ""}) and returns the deduped sorted union
     * as single-character entries in WUBRG order (the standard MTG
     * color-pie traversal). Stable across renders.
     *
     * <p>Partners / background pairings exercise the union path
     * (e.g. {@code ["WU", "BG"]} → {@code ["W","U","B","G"]}). Empty
     * input or all-empty / null entries → {@link List#of()}.
     *
     * <p>Package-private + visible for unit testing without needing
     * to construct upstream {@code CommanderView} fixtures (which
     * require a heavy {@code Commander} + {@code Card} + {@code Game}
     * constructor chain).
     */
    static List<String> unionColorIdentity(List<String> identityStrings) {
        if (identityStrings == null || identityStrings.isEmpty()) {
            return List.of();
        }
        java.util.Set<Character> seen = new java.util.LinkedHashSet<>();
        for (char color : "WUBRG".toCharArray()) {
            for (String identity : identityStrings) {
                if (identity != null && identity.indexOf(color) >= 0) {
                    seen.add(color);
                    break;
                }
            }
        }
        if (seen.isEmpty()) {
            return List.of();
        }
        List<String> out = new ArrayList<>(seen.size());
        for (Character c : seen) {
            out.add(String.valueOf(c));
        }
        return List.copyOf(out);
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
                // Slice 70-X.2 — carry the collector number (string)
                // alongside imageNumber. xmage's MageObject.imageNumber
                // defaults to 0 for ordinary cards (only tokens / face-
                // down get explicit values), so the webclient's
                // Scryfall URL builder needs cardNumber to find real
                // commander art. The CommandObjectView interface
                // doesn't declare getCardNumber(), but the two
                // concrete subclasses that DO carry one (CommanderView
                // via CardView/SimpleCardView, EmblemView directly)
                // expose it; DungeonView + PlaneView have no
                // collector-number concept and emit empty.
                cardNumberFor(co),
                co.getRules() == null ? List.of() : List.copyOf(co.getRules())
        );
    }

    /**
     * Slice 70-X.2 — extract the collector-number string from a
     * {@link CommandObjectView}, which doesn't declare
     * {@code getCardNumber()} on the interface itself. Type-narrowing
     * by concrete subclass, mirroring the dispatch in
     * {@link #kindFor(CommandObjectView)}. Empty string when the
     * subclass has no collector-number concept (dungeon, plane).
     */
    private static String cardNumberFor(CommandObjectView co) {
        if (co instanceof CommanderView cv) {
            return nullToEmpty(cv.getCardNumber());
        }
        if (co instanceof EmblemView ev) {
            return nullToEmpty(ev.getCardNumber());
        }
        return "";
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
        return toClientMessage(gcm, Map.of(), MultiplayerFrameContext.EMPTY, null);
    }

    /**
     * Slice 70-X.13 — RoI-aware overload for dialog frames.
     * <p>
     * Without this threading, {@code mapClientMessage} (gameInform /
     * gameAsk / gameTarget / gameSelect / gameInformPersonal / etc.)
     * would route the embedded {@link GameView} through the no-arg
     * {@code toDto} and bypass the slice-69c per-recipient
     * range-of-influence filter — leaking the full player roster +
     * connection state outside the recipient's RoI in 3+ player games.
     * Pass the same {@code stackHint}, {@code mpCtx},
     * {@code playersInRange} resolved by
     * {@code WebSocketCallbackHandler.mapGameView} so dialog frames
     * carry the same per-recipient view the engine intended.
     */
    public static WebGameClientMessage toClientMessage(
            GameClientMessage gcm,
            Map<UUID, UUID> stackCardIdHint,
            MultiplayerFrameContext mpCtx,
            Set<UUID> playersInRange) {
        if (gcm == null) {
            throw new IllegalArgumentException("GameClientMessage must not be null");
        }
        WebGameView wrapped = gcm.getGameView() == null
                ? null
                : toDto(gcm.getGameView(), stackCardIdHint, mpCtx, playersInRange);
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
        // Slice 70-X.14 Wave 3 — pile 2 + multi-amount payloads. Both
        // are no-op for non-pile / non-multi-amount frames (cardsView2
        // empty map; multiAmount null), but pile-pick and trample-
        // damage callbacks now have their wire shape carried through
        // instead of being silently dropped on the floor.
        Map<String, WebCardView> cardsView2 = CardViewMapper.toCardMap(gcm.getCardsView2());
        WebMultiAmountInfo multiAmount = extractMultiAmount(gcm);
        return new WebGameClientMessage(
                wrapped,
                nullToEmpty(gcm.getMessage()),
                targets,
                CardViewMapper.toCardMap(gcm.getCardsView1()),
                gcm.getMin(),
                gcm.getMax(),
                gcm.isFlag(),
                choice,
                extractOptions(gcm.getOptions()),
                cardsView2,
                multiAmount
        );
    }

    /**
     * Slice 70-X.14 Wave 3 — extract the multi-amount payload from
     * upstream's {@code GameClientMessage}. Returns {@code null} for
     * frames that don't carry messages (i.e. anything other than
     * {@code GAME_GET_MULTI_AMOUNT}). Wire stays compact for the
     * common case.
     */
    static WebMultiAmountInfo extractMultiAmount(GameClientMessage gcm) {
        var upstreamMessages = gcm.getMessages();
        if (upstreamMessages == null || upstreamMessages.isEmpty()) {
            return null;
        }
        List<WebMultiAmountRow> rows = new ArrayList<>(upstreamMessages.size());
        for (mage.util.MultiAmountMessage m : upstreamMessages) {
            if (m == null) continue;
            rows.add(new WebMultiAmountRow(
                    m.message == null ? "" : m.message,
                    m.min,
                    m.max,
                    m.defaultValue
            ));
        }
        // Title / header sourced from upstream's options map. Per the
        // rules-expert validation pass: upstream's MultiAmountType
        // surfaces these via the options entries with keys
        // {@code "MULTI_AMOUNT_TITLE"} / {@code "MULTI_AMOUNT_HEADER"}.
        // Empty strings when upstream supplied none.
        String title = readStringOption(gcm, "MULTI_AMOUNT_TITLE");
        String header = readStringOption(gcm, "MULTI_AMOUNT_HEADER");
        return new WebMultiAmountInfo(
                title,
                header,
                rows,
                gcm.getMin(),
                gcm.getMax()
        );
    }

    private static String readStringOption(GameClientMessage gcm, String key) {
        if (gcm.getOptions() == null) return "";
        Object v = gcm.getOptions().get(key);
        return v == null ? "" : v.toString();
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
                WebClientMessageOptions.EMPTY,
                Map.of(),
                null
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
