package mage.webapi.auth;

import org.jboss.remoting.callback.AsynchInvokerCallbackHandler;
import org.jboss.remoting.callback.Callback;

/**
 * Drops every callback. Used by Phase 2 slice 5 to give the upstream
 * {@code SessionManagerImpl} a callback handler when registering a new
 * session, before the WebSocket-backed handler arrives in Phase 3.
 *
 * <p>Per ADR 0004 D8: login/logout work fine without game-state
 * callbacks; trying to play a game with this handler in place would
 * silently lose all server pushes. Phase 3 replaces it.
 *
 * <p>Implements {@link AsynchInvokerCallbackHandler} (not just
 * {@code InvokerCallbackHandler}) because {@code Session.java} casts
 * to the async interface during construction.
 */
public final class NoOpCallbackHandler implements AsynchInvokerCallbackHandler {

    @Override
    public void handleCallback(Callback callback) {
        // intentionally empty — see class javadoc
    }

    @Override
    public void handleCallbackOneway(Callback callback) {
        // intentionally empty
    }

    @Override
    public void handleCallbackOneway(Callback callback, boolean async) {
        // intentionally empty
    }

    @Override
    public void handleCallback(Callback callback, boolean serverSide, boolean async) {
        // intentionally empty
    }
}
