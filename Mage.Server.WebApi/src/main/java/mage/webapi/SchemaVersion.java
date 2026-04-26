package mage.webapi;

/**
 * Single source of truth for the JSON wire-format schema version. Every
 * DTO record must include {@link #CURRENT} as its {@code schemaVersion}
 * field. Bump on breaking changes; record the change in
 * {@code docs/schema/CHANGELOG.md}.
 *
 * <p>Versioning policy:
 * <ul>
 *   <li>Major bump (1.0 → 2.0): breaking change. Clients refuse to connect.</li>
 *   <li>Minor bump (1.0 → 1.1): additive change. Clients warn and continue.</li>
 * </ul>
 */
public final class SchemaVersion {

    public static final String CURRENT = "1.12";

    private SchemaVersion() {
    }
}
