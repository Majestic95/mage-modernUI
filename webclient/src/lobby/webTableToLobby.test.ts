/**
 * Slice L2 — locks the WebTable → LobbyFixture mapping. Drop these
 * and a wire-shape change to WebSeat would silently swap fields in
 * the seat plate (deckName/deckSize) or break the host crown
 * comparison.
 */
import { describe, expect, it } from 'vitest';
import type { WebTable } from '../api/schemas';
import { webTableToLobby } from './webTableToLobby';

function baseTable(overrides: Partial<WebTable> = {}): WebTable {
  return {
    tableId: '11111111-1111-1111-1111-111111111111',
    tableName: "alice's table",
    gameType: 'Free For All',
    deckType: 'Commander',
    tableState: 'WAITING',
    createTime: '2026-05-02T12:00:00Z',
    controllerName: 'alice',
    skillLevel: 'CASUAL',
    isTournament: false,
    passworded: false,
    spectatorsAllowed: true,
    rated: false,
    limited: false,
    seats: [
      {
        playerName: 'alice',
        playerType: 'HUMAN',
        occupied: true,
        commanderName: "Atraxa, Praetors' Voice",
        commanderImageNumber: 281,
        ready: false,
        deckName: 'Proliferate Control',
        deckSize: 100,
        deckSizeRequired: 100,
      },
      {
        playerName: 'bob',
        playerType: 'HUMAN',
        occupied: true,
        commanderName: 'Nicol Bolas, Dragon-God',
        commanderImageNumber: 207,
        ready: true,
        deckName: 'Bolas Control',
        deckSize: 99,
        deckSizeRequired: 100,
      },
      {
        playerName: '',
        playerType: '',
        occupied: false,
        commanderName: '',
        commanderImageNumber: 0,
        ready: false,
        deckName: '',
        deckSize: 0,
        deckSizeRequired: 100,
      },
    ],
    ...overrides,
  };
}

describe('webTableToLobby', () => {
  it('marks the controller seat as host', () => {
    const data = webTableToLobby({
      webTable: baseTable(),
      currentUsername: 'alice',
    });
    expect(data.seats[0]?.isHost).toBe(true);
    expect(data.seats[1]?.isHost).toBe(false);
  });

  it('strips the upstream "controller, opp1, opp2" suffix when present', () => {
    // Defensive — the server's TableMapper already cleans this, but
    // the client mapper guards against a 1.26 server slipping through.
    const data = webTableToLobby({
      webTable: baseTable({ controllerName: 'alice, bob, charlie' }),
      currentUsername: 'alice',
    });
    expect(data.seats[0]?.isHost).toBe(true);
  });

  it('forwards ready/deckName/deckSize from the wire onto the lobby seat', () => {
    const data = webTableToLobby({
      webTable: baseTable(),
      currentUsername: 'alice',
    });
    expect(data.seats[0]?.ready).toBe(false);
    expect(data.seats[1]?.ready).toBe(true);
    expect(data.seats[0]?.deckName).toBe('Proliferate Control');
    expect(data.seats[0]?.deckSize).toBe(100);
    expect(data.seats[0]?.deckRequired).toBe(100);
    expect(data.seats[1]?.deckSize).toBe(99);
  });

  it('extracts subtitle from the commander name (after the comma)', () => {
    const data = webTableToLobby({
      webTable: baseTable(),
      currentUsername: 'alice',
    });
    expect(data.seats[0]?.subtitle).toBe("Praetors' Voice");
    expect(data.seats[1]?.subtitle).toBe('Dragon-God');
  });

  it('renders empty subtitle for non-comma commander names', () => {
    const data = webTableToLobby({
      webTable: baseTable({
        seats: [
          {
            playerName: 'alice',
            playerType: 'HUMAN',
            occupied: true,
            commanderName: 'Karn, Scion of Urza',
            commanderImageNumber: 1,
            ready: false,
            deckName: 'Karn',
            deckSize: 100,
            deckSizeRequired: 100,
          },
          {
            playerName: 'bob',
            playerType: 'HUMAN',
            occupied: true,
            commanderName: 'The Ur-Dragon',
            commanderImageNumber: 1,
            ready: false,
            deckName: '',
            deckSize: 0,
            deckSizeRequired: 100,
          },
        ],
      }),
      currentUsername: 'alice',
    });
    // "Karn, Scion of Urza" → "Scion of Urza" (has comma)
    expect(data.seats[0]?.subtitle).toBe('Scion of Urza');
    // "The Ur-Dragon" → empty (no comma)
    expect(data.seats[1]?.subtitle).toBe('');
  });

  it('passes empty seats through with occupied=false and no commander art', () => {
    const data = webTableToLobby({
      webTable: baseTable(),
      currentUsername: 'alice',
    });
    expect(data.seats[2]?.occupied).toBe(false);
    expect(data.seats[2]?.commanderArtUrl).toBeNull();
    expect(data.seats[2]?.commanderCardImageUrl).toBeNull();
  });

  it('infers color identity for known commanders, empty for unknown', () => {
    const data = webTableToLobby({
      webTable: baseTable({
        seats: [
          {
            playerName: 'alice',
            playerType: 'HUMAN',
            occupied: true,
            commanderName: "Atraxa, Praetors' Voice",
            commanderImageNumber: 281,
            ready: false,
            deckName: 'Atraxa',
            deckSize: 100,
            deckSizeRequired: 100,
          },
          {
            playerName: 'bob',
            playerType: 'HUMAN',
            occupied: true,
            commanderName: 'Some Unknown Legend',
            commanderImageNumber: 1,
            ready: false,
            deckName: 'Mystery',
            deckSize: 100,
            deckSizeRequired: 100,
          },
        ],
      }),
      currentUsername: 'alice',
    });
    expect(data.seats[0]?.colorIdentity).toEqual(['W', 'U', 'B', 'G']);
    // Unknown commander falls back to empty (neutral team ring).
    expect(data.seats[1]?.colorIdentity).toEqual([]);
  });

  it('derives Commander format → 40 starting life, others → 20', () => {
    const commander = webTableToLobby({
      webTable: baseTable({ deckType: 'Commander' }),
      currentUsername: 'alice',
    });
    expect(commander.matchOptions.startingLife).toBe(40);

    const standard = webTableToLobby({
      webTable: baseTable({ deckType: 'Constructed - Standard' }),
      currentUsername: 'alice',
    });
    expect(standard.matchOptions.startingLife).toBe(20);
  });

  it('maps passworded → "Password" privacy label, public → "Public"', () => {
    const passworded = webTableToLobby({
      webTable: baseTable({ passworded: true }),
      currentUsername: 'alice',
    });
    expect(passworded.matchOptions.privacyLabel).toBe('Password');

    const open = webTableToLobby({
      webTable: baseTable({ passworded: false }),
      currentUsername: 'alice',
    });
    expect(open.matchOptions.privacyLabel).toBe('Public');
  });

  it('sets playerCount from seat array length', () => {
    const data = webTableToLobby({
      webTable: baseTable(),
      currentUsername: 'alice',
    });
    expect(data.matchOptions.playerCount).toBe(3);
  });

  it('canonicalizes known formats / modes to lowercase IDs', () => {
    const data = webTableToLobby({
      webTable: baseTable({
        deckType: 'Commander',
        gameType: 'Free For All',
      }),
      currentUsername: 'alice',
    });
    expect(data.matchOptions.format).toBe('commander');
    expect(data.matchOptions.mode).toBe('free-for-all');
  });

  it('passes unknown formats / modes through verbatim', () => {
    const data = webTableToLobby({
      webTable: baseTable({
        deckType: 'Brand-New Format',
        gameType: 'Brand-New Mode',
      }),
      currentUsername: 'alice',
    });
    expect(data.matchOptions.format).toBe('Brand-New Format');
    expect(data.matchOptions.mode).toBe('Brand-New Mode');
  });
});
