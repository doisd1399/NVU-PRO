package com.nvu.operacional;

/**
 * Producer-order guard for MediaProjection frames.
 *
 * IMPORTANT: Image.getTimestamp() is source-defined and must never be subtracted from
 * a callback wall clock. Different Android/OEM producers can use a different timestamp
 * timebase. We therefore use the image timestamp only relative to the previous image
 * from the SAME ImageReader producer. Queue age is controlled by acquireLatestImage()
 * outside WAITING_FREIGHT and by the ImageReader(3) bound during ordered freight touch
 * capture.
 */
final class GtoFrameFreshnessPolicy {
    private GtoFrameFreshnessPolicy() {}

    static boolean shouldConsume(
        long previousProducerTimestampNs,
        long imageTimestampNs,
        boolean criticalTouchWindow
    ) {
        // A missing timestamp is not grounds to blind the observer.
        if (imageTimestampNs <= 0L || previousProducerTimestampNs <= 0L) return true;

        // Normal same-producer progression.
        if (imageTimestampNs > previousProducerTimestampNs) return true;

        // A producer/session can legitimately restart its timestamp domain after a surface
        // rebind/resize. Accept the first regressed value and let it become the new baseline.
        if (imageTimestampNs < previousProducerTimestampNs) return true;

        // Exact duplicate buffers add no information. During a critical touch pulse keep
        // fail-open semantics so an OEM timestamp quirk cannot erase the only press frame.
        return criticalTouchWindow;
    }
}
