package mage.webapi;

import mage.utils.MageVersion;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Boot-time safety check: verify the upstream {@link MageVersion} the
 * facade was built against matches the version actually present at
 * runtime. Mismatch is a strong signal that a Maven dependency drifted
 * (e.g. someone bumped {@code <upstream.version>} in Mage.Common's pom
 * without bumping our pinned constant) — and quiet drift here is how
 * subtle wire-format regressions sneak in.
 *
 * <p>The pinned constant matches {@code <upstream.version>} in
 * {@code Mage.Server.WebApi/pom.xml}. Bump both together when the
 * upstream version is intentionally moved.
 */
public final class UpstreamVersionCheck {

    private static final Logger LOG = LoggerFactory.getLogger(UpstreamVersionCheck.class);

    public static final String PINNED_UPSTREAM_VERSION = "1.4.58";

    private UpstreamVersionCheck() {
    }

    /**
     * Logs the runtime upstream version and warns loudly on drift.
     * Returns the runtime version string so callers can include it in
     * boot logs or expose it via {@code /api/version}.
     */
    public static String runAtBoot() {
        String runtime = runtimeVersion();
        if (PINNED_UPSTREAM_VERSION.equals(runtime)) {
            LOG.info("Upstream version OK: {} (pinned: {})", runtime, PINNED_UPSTREAM_VERSION);
        } else {
            LOG.warn("UPSTREAM VERSION DRIFT — pinned={}, runtime={}. "
                    + "Wire-format DTO mappers were validated against the "
                    + "pinned version; verify CardViewMapper/GameViewMapper "
                    + "still cover all upstream view fields before shipping.",
                    PINNED_UPSTREAM_VERSION, runtime);
        }
        return runtime;
    }

    public static String runtimeVersion() {
        return MageVersion.MAGE_VERSION_MAJOR + "."
                + MageVersion.MAGE_VERSION_MINOR + "."
                + MageVersion.MAGE_VERSION_RELEASE;
    }
}
