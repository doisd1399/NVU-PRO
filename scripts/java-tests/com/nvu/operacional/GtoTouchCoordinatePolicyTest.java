package com.nvu.operacional;

public final class GtoTouchCoordinatePolicyTest {
    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
        System.out.println("PASS " + message);
    }

    public static void main(String[] args) {
        GtoTouchCoordinatePolicy.Resolution capture = GtoTouchCoordinatePolicy.resolve(
            2, true, 0, true, 1, true, 0, true
        );
        check(capture.isResolved() && capture.row == 2
            && GtoTouchCoordinatePolicy.SOURCE_CAPTURE.equals(capture.source),
            "capture space has highest confidence");

        GtoTouchCoordinatePolicy.Resolution raw = GtoTouchCoordinatePolicy.resolve(
            -1, false, 1, true, 2, false, -1, false
        );
        check(raw.isResolved() && raw.row == 1
            && GtoTouchCoordinatePolicy.SOURCE_RAW.equals(raw.source),
            "raw space resolves a unique row without visual confirmation");

        GtoTouchCoordinatePolicy.Resolution local = GtoTouchCoordinatePolicy.resolve(
            -1, false, -1, false, 3, true, -1, false
        );
        check(local.isResolved() && local.row == 3
            && GtoTouchCoordinatePolicy.SOURCE_LOCAL.equals(local.source),
            "local space resolves when raw is unavailable");

        GtoTouchCoordinatePolicy.Resolution transformed = GtoTouchCoordinatePolicy.resolve(
            -1, false, 1, true, -1, false, 0, true
        );
        check(transformed.isResolved() && transformed.row == 0
            && GtoTouchCoordinatePolicy.SOURCE_DISPLAY_TRANSFORM.equals(transformed.source),
            "display transform precedes the legacy direct raw fallback");

        GtoTouchCoordinatePolicy.Resolution rowNotFound = GtoTouchCoordinatePolicy.resolve(
            -1, true, -1, false, -1, false, -1, false
        );
        check(!rowNotFound.isResolved() && "ROW_NOT_FOUND".equals(rowNotFound.failureReason),
            "a reliable coordinate outside every card never chooses nearest row");

        GtoTouchCoordinatePolicy.Resolution unavailable = GtoTouchCoordinatePolicy.resolve(
            -1, false, -1, false, -1, false, -1, false
        );
        check(!unavailable.isResolved() && "TOUCH_COORDINATES_UNAVAILABLE".equals(unavailable.failureReason),
            "redacted outside coordinates remain fail-closed with an exact reason");
    }
}
