package mage.webapi.auth;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;

/**
 * Mutable {@link Clock} for deterministic time-based tests. Advances
 * only when {@link #advance(Duration)} is called.
 */
final class TestClock extends Clock {

    private Instant now;
    private final ZoneId zone;

    TestClock(Instant initial) {
        this(initial, ZoneId.of("UTC"));
    }

    private TestClock(Instant initial, ZoneId zone) {
        this.now = initial;
        this.zone = zone;
    }

    void advance(Duration delta) {
        now = now.plus(delta);
    }

    @Override
    public ZoneId getZone() {
        return zone;
    }

    @Override
    public Clock withZone(ZoneId zone) {
        return new TestClock(now, zone);
    }

    @Override
    public Instant instant() {
        return now;
    }
}
