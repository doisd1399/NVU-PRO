package com.nvu.operacional;

/** Owns capture-session lifecycle state; it does not create overlays or submit trips. */
public final class GtoCaptureController {
    public enum State { IDLE, REQUESTING_PERMISSION, ACTIVE, STOPPING }
    private State state = State.IDLE;

    public synchronized State state() { return state; }
    public synchronized void requestPermission() { state = State.REQUESTING_PERMISSION; }
    public synchronized void markActive() { state = State.ACTIVE; }
    public synchronized void stop() { state = State.STOPPING; state = State.IDLE; }
    public synchronized boolean isActive() { return state == State.ACTIVE; }
}
