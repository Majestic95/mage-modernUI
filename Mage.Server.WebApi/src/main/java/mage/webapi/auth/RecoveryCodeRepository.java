package mage.webapi.auth;

import com.j256.ormlite.dao.Dao;
import com.j256.ormlite.dao.DaoManager;
import com.j256.ormlite.jdbc.JdbcConnectionSource;
import com.j256.ormlite.stmt.DeleteBuilder;
import com.j256.ormlite.stmt.QueryBuilder;
import com.j256.ormlite.stmt.SelectArg;
import com.j256.ormlite.support.ConnectionSource;
import com.j256.ormlite.support.DatabaseConnection;
import com.j256.ormlite.table.TableUtils;
import mage.cards.repository.DatabaseUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.File;
import java.sql.SQLException;
import java.util.List;
import java.util.Locale;

/**
 * Slice F24 (2026-05-04) — ORMLite repository for the per-user recovery
 * code. Mirrors the singleton pattern of upstream's
 * {@code mage.server.AuthorizedUserRepository} so future maintainers
 * see one shape across the auth-persistence surface.
 *
 * <p>Storage: separate H2 file ({@code db/webapi_recovery.h2.*}) so the
 * upstream-tracked {@code authorized_user.h2} schema is untouched. The
 * file is auto-created on first construction; rows are upserted on
 * register and rotated on successful recover.
 *
 * <p>The recovery-code cleartext is shown to the user ONCE at register
 * (in {@code WebRegisterResponse}) and ONCE more after a successful
 * recover (in {@code WebRecoverResponse}). Only the SHA-256 hash + salt
 * + iterations are persisted, mirroring upstream's password-storage
 * scheme for {@code AuthorizedUser}.
 *
 * <p>Username is keyed lowercase at the service boundary; the column
 * itself uses ORMLite's default case-sensitive PK, so callers MUST
 * lowercase before {@link #add}, {@link #getByUsername}, or
 * {@link #remove} (matches upstream's {@code IGNORECASE=TRUE} JDBC
 * default — but we don't rely on it for correctness here, just for
 * collation).
 *
 * <p>Slice F24.1 (2026-05-04, post-review) — write methods now
 * propagate {@code SQLException} as {@link RecoveryRepositoryException}
 * (a {@code RuntimeException}) instead of silently swallowing it. The
 * pre-F24.1 swallow-and-log pattern (mirrored from upstream's
 * {@code AuthorizedUserRepository}) was load-bearing for upstream
 * (best-effort writes were tolerable) but catastrophic for recovery-
 * code rotation: a silent rotation failure would leave the user with
 * a "fresh" code that doesn't verify and the OLD code still valid,
 * silently breaking single-use semantics. Callers must now catch the
 * thrown exception explicitly to surface a 500 to the user.
 */
public final class RecoveryCodeRepository {

    private static final Logger LOG = LoggerFactory.getLogger(RecoveryCodeRepository.class);
    private static final String DB_NAME = "webapi_recovery.h2";

    /**
     * Lazy-init guard. Tests construct an isolated instance via the
     * package-private ctor; production goes through {@link #getInstance}.
     */
    private static volatile RecoveryCodeRepository instance;

    private Dao<RecoveryCodeRow, String> dao;

    public static RecoveryCodeRepository getInstance() {
        RecoveryCodeRepository local = instance;
        if (local == null) {
            synchronized (RecoveryCodeRepository.class) {
                local = instance;
                if (local == null) {
                    local = new RecoveryCodeRepository(
                            DatabaseUtils.prepareH2Connection(DB_NAME, false));
                    instance = local;
                }
            }
        }
        return local;
    }

    /**
     * Visible-for-test: tests pass a custom JDBC connection string so
     * each test class can target its own H2 file (or a memory DB) and
     * not race the production singleton.
     */
    RecoveryCodeRepository(String connectionString) {
        File dbDir = new File("db");
        if (!dbDir.exists()) {
            dbDir.mkdirs();
        }
        try {
            ConnectionSource cs = new JdbcConnectionSource(connectionString);
            TableUtils.createTableIfNotExists(cs, RecoveryCodeRow.class);
            dao = DaoManager.createDao(cs, RecoveryCodeRow.class);
        } catch (SQLException ex) {
            LOG.error("Error creating webapi_recovery_code repository", ex);
            throw new RecoveryRepositoryException(
                    "Failed to initialize recovery-code repository", ex);
        }
    }

    public void add(RecoveryCodeRow row) {
        try {
            row.username = lower(row.username);
            dao.create(row);
        } catch (SQLException ex) {
            LOG.error("Error adding recovery row for {}", row.username, ex);
            throw new RecoveryRepositoryException(
                    "Failed to write recovery row", ex);
        }
    }

    public void update(RecoveryCodeRow row) {
        try {
            row.username = lower(row.username);
            dao.update(row);
        } catch (SQLException ex) {
            LOG.error("Error updating recovery row for {}", row.username, ex);
            throw new RecoveryRepositoryException(
                    "Failed to update recovery row", ex);
        }
    }

    /**
     * Upsert: replace an existing row or insert a fresh one. Used by
     * the recover-success path so a freshly-rotated code overwrites
     * the prior one atomically (delete-then-create is racy).
     */
    public void addOrUpdate(RecoveryCodeRow row) {
        if (getByUsername(row.username) == null) {
            add(row);
        } else {
            update(row);
        }
    }

    public RecoveryCodeRow getByUsername(String username) {
        if (username == null) {
            return null;
        }
        try {
            QueryBuilder<RecoveryCodeRow, String> qb = dao.queryBuilder();
            qb.where().eq("username", new SelectArg(lower(username)));
            List<RecoveryCodeRow> results = dao.query(qb.prepare());
            if (results.size() == 1) {
                return results.get(0);
            }
            return null;
        } catch (SQLException ex) {
            LOG.error("Error reading recovery row for {}", username, ex);
            // Reads stay fail-open (return null) because the verify
            // path treats null as "no recovery row" → 401, which is
            // the correct user-visible answer when storage is
            // inaccessible. Throwing here would surface as 500 and
            // tell an attacker the storage layer is unhealthy. The
            // ERROR log carries the operator-visible signal.
            return null;
        }
    }

    public void remove(String username) {
        if (username == null) {
            return;
        }
        try {
            DeleteBuilder<RecoveryCodeRow, String> db = dao.deleteBuilder();
            db.where().eq("username", new SelectArg(lower(username)));
            db.delete();
        } catch (SQLException ex) {
            LOG.error("Error removing recovery row for {}", username, ex);
            throw new RecoveryRepositoryException(
                    "Failed to remove recovery row", ex);
        }
    }

    public void closeDB() {
        try {
            if (dao != null && dao.getConnectionSource() != null) {
                DatabaseConnection conn = dao.getConnectionSource()
                        .getReadWriteConnection(dao.getTableName());
                conn.executeStatement("SHUTDOWN IMMEDIATELY",
                        DatabaseConnection.DEFAULT_RESULT_FLAGS);
                dao.getConnectionSource().releaseConnection(conn);
            }
        } catch (SQLException ex) {
            LOG.error("Error closing webapi_recovery_code repository", ex);
        }
    }

    private static String lower(String username) {
        return username == null ? null : username.toLowerCase(Locale.ROOT);
    }

    /**
     * Slice F24.1 — runtime exception thrown by every write method on
     * SQL failure. Caught at the {@link AuthService} boundary and
     * mapped to a 500 {@code UPSTREAM_ERROR} response. Unchecked so
     * existing call sites don't have to declare {@code throws} (and
     * to match upstream's overall pattern of unchecked DB errors).
     */
    public static final class RecoveryRepositoryException extends RuntimeException {
        public RecoveryRepositoryException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
