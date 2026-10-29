package com.nvu.operacional;

import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** Regression coverage for the PRO operation-card stale snapshot race. */
public class SimpleAutomationOperationSnapshotTest {

    @Test
    public void acceptsAuthoritativeRollbackWhenRevisionIsNewer() {
        // Confirmed native state: 08 trips.
        assertTrue(SimpleAutomationService.shouldAcceptOperationSnapshot(
            "job-1", "job-1", 8, 9, false, false, 100L, 101L));

        // A freshly confirmed trip moves the card to 09.
        assertTrue(SimpleAutomationService.shouldAcceptOperationSnapshot(
            "job-1", "job-1", 9, 9, false, false, 101L, 102L));

        // Legitimate deletion/reconciliation: the operation moves 09 -> 08 and
        // the newer revision makes the rollback authoritative.
        assertTrue(SimpleAutomationService.shouldAcceptOperationSnapshot(
            "job-1", "job-1", 9, 8, false, false, 102L, 103L));
    }

    @Test
    public void allowsProgressToAdvanceNormally() {
        assertTrue(SimpleAutomationService.shouldAcceptOperationSnapshot(
            "job-1", "job-1", 8, 9, false, false, 200L, 201L));
        assertTrue(SimpleAutomationService.shouldAcceptOperationSnapshot(
            "job-1", "job-1", 9, 10, false, true, 201L, 202L));
    }

    @Test
    public void differentOperationIdentityCanResetProgress() {
        // A new job is allowed to start from a lower progress value.
        assertTrue(SimpleAutomationService.shouldAcceptOperationSnapshot(
            "job-1", "job-2", 9, 0, true, false, 300L, 1L));
    }
}
