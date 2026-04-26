package mage.webapi.mapper;

import mage.view.GameView;
import mage.view.ManaPoolView;
import mage.view.PlayerView;
import mage.view.TableClientMessage;
import mage.webapi.dto.stream.WebGameView;
import mage.webapi.dto.stream.WebManaPoolView;
import mage.webapi.dto.stream.WebPlayerView;
import mage.webapi.dto.stream.WebStartGameInfo;

import java.util.ArrayList;
import java.util.List;

/**
 * Maps upstream game-state views to wire DTOs.
 *
 * <ul>
 *   <li>{@link GameView} → {@link WebGameView} — top-level scalars +
 *       per-player summaries + the controlling player's hand (slice 4
 *       added {@code myPlayerId} + {@code myHand}).</li>
 *   <li>{@link PlayerView} → {@link WebPlayerView} — life / counts /
 *       mana pool / state flags + battlefield map (slice 4).</li>
 *   <li>{@link ManaPoolView} → {@link WebManaPoolView} — six color
 *       buckets.</li>
 *   <li>{@link TableClientMessage} → {@link WebStartGameInfo} — the
 *       slim subset populated by {@code ccGameStarted}.</li>
 * </ul>
 *
 * <p>Stack, exile, revealed/looked-at, combat groups, and full
 * graveyard/exile/sideboard card maps stay deferred to slice 5+.
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
                pv.getGraveyard() == null ? 0 : pv.getGraveyard().size(),
                pv.getExile() == null ? 0 : pv.getExile().size(),
                pv.getSideboard() == null ? 0 : pv.getSideboard().size(),
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

    private static String nullToEmpty(String s) {
        return s == null ? "" : s;
    }
}
