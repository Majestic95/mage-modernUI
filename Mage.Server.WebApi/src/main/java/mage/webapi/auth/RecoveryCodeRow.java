package mage.webapi.auth;

import com.j256.ormlite.field.DatabaseField;
import com.j256.ormlite.table.DatabaseTable;

/**
 * Slice F24 (2026-05-04) — ORMLite entity for the per-user recovery
 * code persistence layer. One row per registered user. Stored in
 * its own H2 file ({@code db/webapi_recovery.h2.*}) so we don't
 * have to share a schema with upstream's read-only-tracked
 * {@code authorized_user.h2}.
 *
 * <p>The recovery code itself is never stored in cleartext — only
 * the SHA-256 hash + salt + iterations, mirroring the scheme
 * upstream's {@code AuthorizedUserRepository.add()} uses for
 * passwords. The cleartext code is shown to the user ONCE in the
 * {@code WebRegisterResponse} on register and ONCE more in the
 * {@code WebRecoverResponse} after a successful recovery (rotated
 * single-use semantics).
 *
 * <p>Username is the primary key (case-insensitive matching is
 * enforced by lowercasing at the service boundary). Fields are
 * package-private — accessed via reflection in the repository for
 * read paths and via setters at write time.
 */
@DatabaseTable(tableName = "webapi_recovery_code")
public class RecoveryCodeRow {

    @DatabaseField(id = true)
    String username;

    /** Base64-encoded hash of the recovery code (SHA-256 × 1024). */
    @DatabaseField
    String hashB64;

    /** Base64-encoded random salt. */
    @DatabaseField
    String saltB64;

    @DatabaseField
    String hashAlgorithm;

    @DatabaseField
    int hashIterations;

    /** ORMLite default ctor. */
    public RecoveryCodeRow() {
    }

    public RecoveryCodeRow(String username, String hashB64, String saltB64,
                            String hashAlgorithm, int hashIterations) {
        this.username = username;
        this.hashB64 = hashB64;
        this.saltB64 = saltB64;
        this.hashAlgorithm = hashAlgorithm;
        this.hashIterations = hashIterations;
    }
}
