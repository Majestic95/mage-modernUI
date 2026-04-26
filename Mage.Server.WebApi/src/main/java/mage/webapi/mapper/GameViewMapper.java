package mage.webapi.mapper;

import mage.view.CombatGroupView;
import mage.view.GameClientMessage;
import mage.view.GameEndView;
import mage.view.GameView;
import mage.view.ManaPoolView;
import mage.view.PlayerView;
import mage.view.TableClientMessage;
import mage.webapi.dto.stream.WebCombatGroupView;
import mage.webapi.dto.stream.WebGameClientMessage;
import mage.webapi.dto.stream.WebGameEndView;
import mage.webapi.dto.stream.WebGameView;
import mage.webapi.dto.stream.WebManaPoolView;
import mage.webapi.dto.stream.WebPlayerView;
import mage.webapi.dto.stream.WebStartGameInfo;

import java.util.ArrayList;
import java.util.List;
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
                CardViewMapper.toCardMap(gv.getStack()),
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
                        : List.copyOf(pv.getDesignationNames())
        );
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
        return new WebGameClientMessage(
                wrapped,
                nullToEmpty(gcm.getMessage()),
                targets,
                CardViewMapper.toCardMap(gcm.getCardsView1()),
                gcm.getMin(),
                gcm.getMax(),
                gcm.isFlag()
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
                java.util.Map.of(),
                0,
                0,
                false
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
