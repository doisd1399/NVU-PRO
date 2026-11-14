package com.nvu.operacional;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import org.junit.Test;

public class ProOverlayAuthorizationPolicyTest {
    @Test public void activeProjectionRestoresTemporaryGrantWithoutCachedActivity() {
        assertTrue(ProOverlayAuthorizationPolicy.isAuthorized(null, false, true));
        assertTrue(ProOverlayAuthorizationPolicy.isAuthorized(false, false, true));
    }
    @Test public void endedProjectionCannotLeaveAStalePermission() {
        assertFalse(ProOverlayAuthorizationPolicy.isAuthorized(true, true, false));
    }
    @Test public void persistentGrantSurvivesProjectionEnding() {
        assertTrue(ProOverlayAuthorizationPolicy.isAuthorized(true, false, false));
    }
    @Test public void permissionAbsentNeverAuthorizesTheBubble() {
        assertFalse(ProOverlayAuthorizationPolicy.isAuthorized(null, false, false));
        assertFalse(ProOverlayAuthorizationPolicy.isAuthorized(false, false, false));
    }
}
