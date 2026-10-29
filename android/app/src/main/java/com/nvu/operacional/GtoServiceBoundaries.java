package com.nvu.operacional;

/** Composition root for responsibilities shared by the two native modes. */
public final class GtoServiceBoundaries {
    private final GtoCaptureController capture = new GtoCaptureController();
    private final GtoOverlayController overlay = new GtoOverlayController();

    public GtoCaptureController capture() { return capture; }
    public GtoOverlayController overlay() { return overlay; }
    public void onServiceCreated() { capture.requestPermission(); overlay.waitingPermission(); }
    public void onServiceDestroyed() { capture.stop(); overlay.detach(); }
}
