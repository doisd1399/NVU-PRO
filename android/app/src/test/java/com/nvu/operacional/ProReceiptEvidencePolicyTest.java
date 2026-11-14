package com.nvu.operacional;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import org.junit.Test;

public class ProReceiptEvidencePolicyTest {
    @Test public void acknowledgesOnlyTheSameCapturedAmountRouteAndSimulator() {
        assertTrue(ProReceiptEvidencePolicy.matches(256300, "Itapetuna", "Nova Macaé", "global-truck",
            256300, " itapetuna ", "Nova Macaé", "global-truck"));
        assertFalse(ProReceiptEvidencePolicy.matches(256300, "Itapetuna", "Nova Macaé", "global-truck",
            10100, "Itapetuna", "Nova Macaé", "global-truck"));
        assertFalse(ProReceiptEvidencePolicy.matches(256300, "Itapetuna", "Nova Macaé", "global-truck",
            256300, "Itapetuna", "Outra cidade", "global-truck"));
        assertFalse(ProReceiptEvidencePolicy.matches(256300, "Itapetuna", "Nova Macaé", "global-truck",
            256300, "Itapetuna", "Nova Macaé", "toe-3"));
    }
}
