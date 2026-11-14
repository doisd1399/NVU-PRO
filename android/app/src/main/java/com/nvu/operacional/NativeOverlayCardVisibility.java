package com.nvu.operacional;

import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.Set;

/** Main-thread leases: an old timeout can release only its own surface. */
final class NativeOverlayCardVisibility {
    interface Listener { void onVisibilityChanged(boolean suppressed); }
    private final Set<Object> cards = Collections.newSetFromMap(new IdentityHashMap<>());
    private final Listener listener;
    private boolean closed;

    NativeOverlayCardVisibility(Listener listener) { this.listener = listener; }

    boolean acquire(Object card) {
        if (closed || card == null) return false;
        boolean wasHidden = isSuppressed();
        cards.add(card);
        if (!wasHidden) listener.onVisibilityChanged(true);
        return true;
    }

    void release(Object card) {
        if (closed || card == null || !cards.remove(card)) return;
        if (cards.isEmpty()) listener.onVisibilityChanged(false);
    }

    boolean isSuppressed() { return closed || !cards.isEmpty(); }

    void close() {
        if (closed) return;
        closed = true;
        cards.clear();
        listener.onVisibilityChanged(true);
    }
}
