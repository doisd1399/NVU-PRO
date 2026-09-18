package com.nvu.operacional;

/** Prevents REVIEW_REQUIRED from being used to manually fabricate an almost-empty freight. */
final class GtoFreightReviewEligibilityPolicy {
    private GtoFreightReviewEligibilityPolicy() {}

    static int automaticFieldCount(String cargo, String origin, String destination, String distance, String value) {
        int count = 0;
        if (GtoFreightReviewPolicy.isAutomaticTextUsable(cargo)) count++;
        if (GtoFreightReviewPolicy.isAutomaticTextUsable(origin)) count++;
        if (GtoFreightReviewPolicy.isAutomaticTextUsable(destination)) count++;
        if (GtoFreightReviewPolicy.isManualValueValid(GtoFreightReviewPolicy.DISTANCE, distance)) count++;
        if (GtoFreightReviewPolicy.isManualValueValid(GtoFreightReviewPolicy.VALUE, value)) count++;
        return count;
    }

    static boolean mayAskDriver(String cargo, String origin, String destination, String distance, String value) {
        int automatic = automaticFieldCount(cargo, origin, destination, distance, value);
        int missing = 5 - automatic;
        return automatic >= 3 && missing <= 2;
    }
}
