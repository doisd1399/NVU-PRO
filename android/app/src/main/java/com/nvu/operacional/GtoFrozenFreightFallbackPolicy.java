package com.nvu.operacional;

/**
 * Evidence from the immutable pre-touch row is allowed to fill a field that the precise
 * selected-row OCR missed. It never overwrites a valid precise read and it never invents
 * values; all values remain literal and must pass the ordinary field validator.
 */
final class GtoFrozenFreightFallbackPolicy {
    private GtoFrozenFreightFallbackPolicy() {}

    static boolean canUse(String field, String value) {
        return GtoFreightReviewPolicy.isManualValueValid(field, value);
    }
}
