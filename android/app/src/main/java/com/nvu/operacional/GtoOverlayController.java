package com.nvu.operacional;

/** Owns overlay availability state; permission and view attachment remain explicit. */
public final class GtoOverlayController {
    public enum State { HIDDEN, WAITING_PERMISSION, ATTACHED, RECOVERING }
    private State state = State.HIDDEN;

    public synchronized State state() { return state; }
    public synchronized void waitingPermission() { state = State.WAITING_PERMISSION; }
    public synchronized void attached() { state = State.ATTACHED; }
    public synchronized void recovering() { state = State.RECOVERING; }
    public synchronized void detach() { state = State.HIDDEN; }
    public synchronized boolean isAttached() { return state == State.ATTACHED; }
}
