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

    /**
     * Audit fix 2026-05-03 — pin the per-aiType skill split. MAD
     * (the minimax AI) needs the slice-47 mitigation cliff; MCTS
     * (Monte Carlo) does not, and benefits from a much lower think-
     * time budget for testing. This test catches a silent merge of
     * the constants without the dispatch site noticing.
     */
    @Test
    void aiSkill_madVsMonteCarlo_split() {
        assertEquals(4, LobbyService.AI_SKILL_MAD,
                "AI_SKILL_MAD remains 4 (slice-47 cliff for ComputerPlayer7).");
        assertEquals(1, LobbyService.AI_SKILL_MONTE_CARLO,
                "AI_SKILL_MONTE_CARLO is 1 — MCTS skill * 2.0s per priority "
                        + "decision; skill=1 → 2s/decision. Higher values produce "
                        + "30-60s AI turns (verified Mage.Player.AIMCTS/ComputerPlayerMCTS).");
        assertEquals(LobbyService.AI_SKILL_MAD, LobbyService.AI_SKILL,
                "AI_SKILL alias must equal AI_SKILL_MAD so the legacy slice-47 "
                        + "test continues to pin the same value.");
    }
}
