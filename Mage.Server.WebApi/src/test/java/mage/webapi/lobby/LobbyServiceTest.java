package mage.webapi.lobby;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Unit tests for {@link LobbyService}. The full integration coverage of
 * {@code addAi} (HTTP path, 204 response, 4xx error shapes) lives in
 * {@code WebApiServerTest}; this file pins the constants that must not
 * silently regress between slices.
 */
class LobbyServiceTest {

    /**
     * Slice 47 — Mad AI plays cards (skill 1→4 mitigation).
     *
     * <p>Pinning this constant catches an accidental revert (the prior
     * value {@code 1} produced zero plays in practice — see
     * {@code docs/decisions/mad-ai-no-plays-recon.md}) without the
     * brittleness of asserting the wire-call to {@code roomJoinTable}.
     *
     * <p>If a future slice intentionally moves to a runtime-configurable
     * skill (e.g., the deferred webclient skill slider), delete this
     * test and add coverage at the request-parsing layer instead.
     */
    @Test
    void aiSkill_isFour_perSlice47() {
        assertEquals(4, LobbyService.AI_SKILL,
                "AI_SKILL must remain 4 — see docs/decisions/mad-ai-no-plays-recon.md. "
                        + "skill < 4 produces silent passes (empty-tree edge case at "
                        + "ComputerPlayer7.java:119); skill > 4 trades wall time for depth "
                        + "we do not need.");
    }
}
