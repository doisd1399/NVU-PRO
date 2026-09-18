package com.nvu.operacional;

public final class GtoCaptureStabilityGateTest {
    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    public static void main(String[] args) {
        GtoCaptureStabilityGate gate = new GtoCaptureStabilityGate();

        GtoCaptureStabilityGate.Snapshot started = gate.reset(
            GtoCaptureStabilityGate.CAPTURE_STARTING,
            1920,
            1080,
            1_000L
        );
        require(!started.ready, "new projection cannot be ready immediately");
        require(started.generation == 1L, "reset must advance generation");

        GtoCaptureStabilityGate.Snapshot inactive = gate.observeFrame(
            1920, 1080, 1_120L, false
        );
        require(!inactive.ready, "inactive session cannot arm analysis");
        require(inactive.stableFrames == 0, "inactive frames cannot count as stable");
        require(
            GtoCaptureStabilityGate.INACTIVE.equals(inactive.phase),
            "gate must expose inactive session phase"
        );

        require(!gate.observeFrame(1920, 1080, 1_200L, true).ready, "frame 1");
        require(!gate.observeFrame(1920, 1080, 1_250L, true).ready, "frame 2");
        GtoCaptureStabilityGate.Snapshot ready = gate.observeFrame(
            1920, 1080, 1_290L, true
        );
        require(ready.ready, "three settled GTO frames must release analysis");
        require(ready.becameReady, "ready edge must be observable exactly once");
        require(ready.stableFrames == 3, "ready requires exactly the configured frame gate");
        require(GtoCaptureStabilityGate.GTO_READY.equals(ready.phase), "ready phase");

        GtoCaptureStabilityGate.Snapshot orientation = gate.reset(
            GtoCaptureStabilityGate.CAPTURE_WAITING_ORIENTATION,
            2400,
            1080,
            1_300L
        );
        require(!orientation.ready, "resize must invalidate previous ready state");
        require(orientation.becameUnready, "resize must expose invalidation edge");
        require(orientation.generation == 2L, "resize must isolate old callbacks");

        GtoCaptureStabilityGate.Snapshot stale = gate.observeFrame(
            1920, 1080, 1_500L, true
        );
        require(!stale.ready, "old-size frame cannot satisfy resized gate");
        require(stale.stableFrames == 0, "old geometry must reset the stable count");

        require(!gate.observeFrame(2400, 1080, 1_510L, true).ready, "new frame 1");
        require(!gate.observeFrame(2400, 1080, 1_560L, true).ready, "new frame 2");
        GtoCaptureStabilityGate.Snapshot resizedReady = gate.observeFrame(
            2400, 1080, 1_590L, true
        );
        require(resizedReady.ready, "resized geometry must settle independently");

        GtoCaptureStabilityGate.Snapshot background = gate.observeFrame(
            2400, 1080, 1_620L, true
        );
        require(background.ready, "foreground/package staleness must not close a live session");
        require(!background.becameUnready, "context loss must not invalidate transport analysis");

        System.out.println("GtoCaptureStabilityGateTest: PASS");
    }
}
