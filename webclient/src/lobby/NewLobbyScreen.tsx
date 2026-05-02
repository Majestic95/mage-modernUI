/**
 * Slice L1 (new-lobby-window) — top-level lobby page. Replaces the
 * legacy CreateTableModal + table-list pre-game flow with a dedicated
 * full-page screen.
 *
 * <p>L1 ships static fixture data only. Slice L2 wires real
 * {@link WebTable} via polling; slice L7 swaps polling for a per-table
 * WebSocket stream. Slice L4 wires the entry path from the slim
 * PreLobbyModal.
 *
 * <p>Reference: docs/design/new-lobby-window.md
 */
import { CommanderPreviewPanel } from './CommanderPreviewPanel';
import { DeckPreviewPanel } from './DeckPreviewPanel';
import { GameSettingsPanel } from './GameSettingsPanel';
import { LOBBY_FIXTURE } from './fixtures';
import { LobbyHeader } from './LobbyHeader';
import { LobbyTopBar } from './LobbyTopBar';
import { MyDecksPanel } from './MyDecksPanel';
import { SeatRow } from './SeatRow';
import { StartGameButton } from './StartGameButton';

interface Props {
  /** Table identifier. L1 ignores this — fixture only. */
  tableId: string;
}

export function NewLobbyScreen({ tableId }: Props) {
  // L1 fixture path — slice L2 will derive from useTableStream(tableId).
  void tableId;
  const fixture = LOBBY_FIXTURE;
  const selectedDeck =
    fixture.decks.find((d) => d.id === fixture.selectedDeckId) ?? null;
  const isHost =
    fixture.seats.find((s) => s.playerName === fixture.currentUsername)
      ?.isHost ?? false;
  const readyCount = fixture.seats.filter((s) => s.occupied && s.ready).length;
  const totalSeats = fixture.matchOptions.playerCount;
  const allReady = readyCount === totalSeats;

  return (
    <div
      data-testid="new-lobby-screen"
      className="relative flex h-screen flex-col overflow-hidden bg-bg-base text-text-primary"
      style={{
        // Subtle nebula gradient backdrop matching the in-game battlefield
        // ambient. Composited from a deep teal-purple radial spotlight
        // over the bg-base canvas.
        backgroundImage:
          'radial-gradient(ellipse 90% 60% at 50% 35%, rgba(139, 92, 246, 0.18) 0%, rgba(76, 29, 149, 0.08) 35%, transparent 70%), radial-gradient(ellipse 60% 40% at 80% 80%, rgba(91, 192, 240, 0.10) 0%, transparent 60%), radial-gradient(ellipse 50% 30% at 15% 90%, rgba(168, 85, 247, 0.10) 0%, transparent 60%)',
      }}
    >
      <LobbyTopBar />

      {/* Main fills remaining viewport height. `min-h-0` is critical:
          without it, flex children retain content-driven heights and
          the page overflows the viewport. The grid splits the space
          between header (auto) and the two content rows; the rows
          share the remaining space at 1.15:1 ratio (matching mockup
          where seats > decks). */}
      <main
        className="grid min-h-0 flex-1 gap-3 px-5 pb-4"
        style={{
          gridTemplateRows: 'auto minmax(0, 1.15fr) minmax(0, 1fr)',
        }}
      >
        <LobbyHeader
          format={fixture.matchOptions.format}
          mode={fixture.matchOptions.mode}
          playerCount={fixture.matchOptions.playerCount}
          readyCount={readyCount}
          totalSeats={totalSeats}
        />

        {/* Top half — settings + seats. Chat panel omitted; the right
            column is intentionally vacant in L1. */}
        <section
          data-testid="lobby-top-row"
          className="grid min-h-0 gap-3"
          style={{
            gridTemplateColumns: 'minmax(220px, 260px) 1fr minmax(280px, 320px)',
          }}
        >
          <GameSettingsPanel
            options={fixture.matchOptions}
            isHost={isHost}
          />
          <SeatRow
            seats={fixture.seats}
            currentUsername={fixture.currentUsername}
          />
          <div aria-hidden="true" />
        </section>

        {/* Bottom half — deck management + commander preview + start. */}
        <section
          data-testid="lobby-bottom-row"
          className="grid min-h-0 gap-3"
          style={{
            gridTemplateColumns:
              'minmax(240px, 280px) minmax(320px, 360px) 1fr minmax(220px, 280px)',
          }}
        >
          <MyDecksPanel
            decks={fixture.decks}
            selectedDeckId={fixture.selectedDeckId}
          />
          <DeckPreviewPanel deck={selectedDeck} />
          <CommanderPreviewPanel deck={selectedDeck} />
          <div className="flex items-end justify-end">
            <StartGameButton
              enabled={isHost && allReady}
              isHost={isHost}
              allReady={allReady}
            />
          </div>
        </section>
      </main>
    </div>
  );
}
