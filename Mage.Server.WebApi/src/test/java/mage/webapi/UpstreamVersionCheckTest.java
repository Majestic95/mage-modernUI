package mage.webapi;

import mage.utils.MageVersion;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

/**
 * Locks the boot-time invariant that our pinned upstream version
 * matches the {@link MageVersion} bundled at compile time. If the
 * upstream Maven dependency drifts without us noticing, this test
 * fails fast — the wire-format mappers were validated against
 * {@link UpstreamVersionCheck#PINNED_UPSTREAM_VERSION}, and a silent
 * drift is exactly how regressions sneak in.
 */
class UpstreamVersionCheckTest {

    @Test
    void runtimeVersionMatchesPinned() {
        String runtime = UpstreamVersionCheck.runtimeVersion();
        assertEquals(UpstreamVersionCheck.PINNED_UPSTREAM_VERSION, runtime,
                "Pinned upstream version drifted from MageVersion. "
                        + "If this drift is intentional, bump both "
                        + "UpstreamVersionCheck.PINNED_UPSTREAM_VERSION "
                        + "and <upstream.version> in pom.xml together.");
    }

    @Test
    void runtimeVersionFollowsMajorMinorReleaseFormat() {
        String runtime = UpstreamVersionCheck.runtimeVersion();
        assertNotNull(runtime);
        // Three dot-separated integer segments.
        String[] parts = runtime.split("\\.");
        assertEquals(3, parts.length, "Expected MAJOR.MINOR.RELEASE: " + runtime);
        for (String p : parts) {
            Integer.parseInt(p);
        }
    }
}
