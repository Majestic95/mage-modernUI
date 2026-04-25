package mage.webapi.mapper;

import mage.utils.MageVersion;
import mage.webapi.SchemaVersion;
import mage.webapi.dto.WebVersion;

/**
 * Translates upstream's {@link MageVersion} into our public {@link WebVersion}
 * DTO. This is one half of the DTO firewall — upstream types stop here.
 *
 * <p>Hand-written deliberately. Auto-derivation (e.g. Jackson reflection over
 * {@code MageVersion} fields) would tie our wire format to upstream's class
 * shape and break silently when upstream renames or repurposes a field.
 */
public final class VersionMapper {

    private VersionMapper() {
    }

    /**
     * Construct a {@link WebVersion} reflecting the constants compiled into
     * the upstream jars. Does not call {@link mage.server.MageServerImpl
     * #getServerState()} (which sleeps 1 s for DDoS protection); for the
     * {@code /api/version} endpoint we read the static constants directly.
     */
    public static WebVersion fromConstants() {
        // Construct directly to read MAGE_VERSION_RELEASE_INFO and the
        // build-time string from the upstream jar's manifest.
        MageVersion mv = new MageVersion(VersionMapper.class);

        String human = MageVersion.MAGE_VERSION_MAJOR + "."
                + MageVersion.MAGE_VERSION_MINOR + "."
                + MageVersion.MAGE_VERSION_RELEASE + "-"
                + MageVersion.MAGE_VERSION_RELEASE_INFO;

        return new WebVersion(
                SchemaVersion.CURRENT,
                human,
                mv.getBuildTime()
        );
    }
}
