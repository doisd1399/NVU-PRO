package com.nvu.operacional;

/** Pure policy for the automatic freight-list bootstrap race. */
final class GtoFreightBootstrapPolicy {
    private GtoFreightBootstrapPolicy() {}

    static boolean isFreshState(String state) {
        return "IDLE".equals(state) || "CANCELLED".equals(state);
    }

    static boolean shouldAwaitSecondListFrame(String state, int observedFrames, int exactPressedRow) {
        return !isFreshState(state) && observedFrames < 2 && exactPressedRow < 0;
    }
}
