package mage.webapi.mapper;

import mage.interfaces.ServerState;
import mage.players.PlayerType;
import mage.view.GameTypeView;
import mage.view.TournamentTypeView;
import mage.webapi.SchemaVersion;
import mage.webapi.dto.WebGameType;
import mage.webapi.dto.WebServerState;
import mage.webapi.dto.WebTournamentType;

import java.util.Arrays;
import java.util.List;

/**
 * Translates upstream {@link ServerState} into our public
 * {@link WebServerState} DTO.
 *
 * <p>This is the first real workout of the DTO firewall: {@link GameTypeView}
 * and {@link TournamentTypeView} are {@code mage.view.*} types and stop
 * here. The mapper extracts only the fields needed for the wire format.
 */
public final class ServerStateMapper {

    private ServerStateMapper() {
    }

    public static WebServerState fromState(ServerState state) {
        return new WebServerState(
                SchemaVersion.CURRENT,
                state.getGameTypes().stream().map(ServerStateMapper::game).toList(),
                state.getTournamentTypes().stream().map(ServerStateMapper::tournament).toList(),
                Arrays.stream(state.getPlayerTypes()).map(PlayerType::toString).toList(),
                List.of(state.getDeckTypes()),
                List.of(state.getDraftCubes()),
                state.isTestMode()
        );
    }

    private static WebGameType game(GameTypeView v) {
        return new WebGameType(
                v.getName(),
                v.getMinPlayers(),
                v.getMaxPlayers(),
                v.getNumTeams(),
                v.getPlayersPerTeam(),
                v.isUseRange(),
                v.isUseAttackOption()
        );
    }

    private static WebTournamentType tournament(TournamentTypeView v) {
        return new WebTournamentType(
                v.getName(),
                v.getMinPlayers(),
                v.getMaxPlayers(),
                v.getNumBoosters(),
                v.isDraft(),
                v.isLimited(),
                v.isCubeBooster(),
                v.isElimination(),
                v.isRandom(),
                v.isReshuffled(),
                v.isRichMan(),
                v.isJumpstart()
        );
    }
}
