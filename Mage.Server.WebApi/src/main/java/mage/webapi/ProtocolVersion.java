package mage.webapi;

import java.util.Set;

/**
 * WebSocket handshake protocol version. Distinct from
 * {@link SchemaVersion} ({@code schemaVersion} is the JSON wire format;
 * {@code protocolVersion} is the handshake contract — frame ordering,
 * route semantics, close-code meanings).
 *
 * <p>Per ADR 0010 v2 D12, the WS upgrade includes a
 * {@code ?protocolVersion=N} query param. Server compares against
 * {@link #SUPPORTED}; mismatched clients receive close {@code 4400}
 * with reason {@code PROTOCOL_VERSION_UNSUPPORTED}. Absent param =
 * server defaults to {@link #CURRENT} for backwards compatibility with
 * pre-slice-69b webclients that don't send the param yet.
 *
 * <p>Versioning policy:
 * <ul>
 *   <li>{@code 1} — pre-v2 multiplayer surface (1v1 only). Sliced from
 *       schema 1.19 and earlier; no explicit envelope.</li>
 *   <li>{@code 2} — v2 multiplayer surface. Ships with schema 1.20:
 *       additive {@code teamId}, {@code goadingPlayerIds},
 *       {@code dialogClear} (slice 69b), {@code gameInformPulse}
 *       (slice 71). N-player layout, eliminated-player semantics.</li>
 * </ul>
 *
 * <p>Once a future v3 ships, the set shrinks to drop deprecated
 * versions. For now both {@code 1} and {@code 2} are accepted during
 * the v2 rollout transition.
 */
public final class ProtocolVersion {

    public static final int CURRENT = 2;

    public static final Set<Integer> SUPPORTED = Set.of(1, 2);

    private ProtocolVersion() {
    }
}
