package mage.webapi.lobby;

import mage.game.Game;
import mage.players.Player;
import mage.webapi.dto.WebDeckCardInfo;

import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * WebApi-owned cosmetic sidecar for player display-card choices.
 *
 * <p>Upstream {@code DeckCardLists -> Deck} conversion drops fields
 * outside the engine deck format, so the display-card selection cannot
 * live on {@code Deck}. Keep it in WebApi memory keyed by table +
 * player name and resolve it for lobby seats and game frames.
 */
public final class DisplayCardRegistry {

    private final ConcurrentHashMap<SeatKey, DisplayCard> bySeat =
            new ConcurrentHashMap<>();

    public void set(UUID tableId, String playerName, WebDeckCardInfo displayCard) {
        if (tableId == null || playerName == null || playerName.isBlank()) return;
        SeatKey key = new SeatKey(tableId, normalize(playerName));
        DisplayCard card = DisplayCard.from(displayCard);
        if (card == null) {
            bySeat.remove(key);
        } else {
            bySeat.put(key, card);
        }
    }

    public void remove(UUID tableId, String playerName) {
        if (tableId == null || playerName == null || playerName.isBlank()) return;
        bySeat.remove(new SeatKey(tableId, normalize(playerName)));
    }

    public void removeTable(UUID tableId) {
        if (tableId == null) return;
        bySeat.keySet().removeIf(key -> tableId.equals(key.tableId()));
    }

    public DisplayCard forSeat(UUID tableId, String playerName) {
        if (tableId == null || playerName == null || playerName.isBlank()) {
            return null;
        }
        return bySeat.get(new SeatKey(tableId, normalize(playerName)));
    }

    public DisplayCard forPlayer(Game game, UUID playerId) {
        if (game == null || playerId == null) return null;
        Player player = game.getPlayer(playerId);
        if (player == null) return null;
        return forSeat(game.getTableId(), player.getName());
    }

    public Map<UUID, DisplayCard> snapshotForGame(Game game) {
        if (game == null || game.getPlayers() == null) return Map.of();
        Map<UUID, DisplayCard> out = new HashMap<>();
        for (UUID playerId : game.getPlayers().keySet()) {
            DisplayCard card = forPlayer(game, playerId);
            if (card != null) {
                out.put(playerId, card);
            }
        }
        return out.isEmpty() ? Map.of() : Map.copyOf(out);
    }

    private static String normalize(String playerName) {
        return playerName.trim().toLowerCase(Locale.ROOT);
    }

    private record SeatKey(UUID tableId, String playerName) {
    }

    public record DisplayCard(
            String name,
            String setCode,
            String cardNumber
    ) {
        static DisplayCard from(WebDeckCardInfo dto) {
            if (dto == null
                    || dto.cardName() == null || dto.cardName().isBlank()
                    || dto.setCode() == null || dto.setCode().isBlank()
                    || dto.cardNumber() == null || dto.cardNumber().isBlank()) {
                return null;
            }
            return new DisplayCard(
                    dto.cardName().trim(),
                    dto.setCode().trim(),
                    dto.cardNumber().trim());
        }
    }
}
