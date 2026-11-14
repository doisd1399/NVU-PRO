package com.nvu.operacional;

import static org.junit.Assert.assertEquals;
import org.junit.Test;

public class ProTripMoneyPresentationTest {
    @Test public void preservedGtoReceiptRecoversMissingSnapshotCurrency() {
        String receipt = "Concluído\nValor a receber: R$ 24.917,00\nReceber\nDobrar valor (ADS)";
        for (String key : new String[]{"global-truck", "GTO", "gto"}) {
            assertEquals("R$ 24.917,00", ProTripMoneyPresentation.format(2491700L, "", key, receipt));
        }
    }
    @Test public void knownRegistryRemainsConsistentWithHistoryEvenWithoutSymbol() {
        assertEquals("R$ 24.917,00", ProTripMoneyPresentation.format(2491700L, "", "global-truck", "Valor a receber: 24.917,00"));
        assertEquals("€ 42,35", ProTripMoneyPresentation.format(4235L, "", "toe-3", "Renda total: 42,35"));
    }
    @Test public void explicitConflictsAreNeverConvertedToReais() {
        assertEquals("24.917,00 · moedas conflitantes", ProTripMoneyPresentation.format(2491700L, "EUR", "global-truck", "Valor a receber: R$ 24.917,00"));
        assertEquals("24.917,00 · moedas conflitantes", ProTripMoneyPresentation.format(2491700L, "", "global-truck", "Valor a receber: CAD 24.917,00"));
    }
    @Test public void unknownSimulatorRemainsNominal() {
        assertEquals("42,35", ProTripMoneyPresentation.format(4235L, "", "unknown-game", "TOTAL 42,35"));
        assertEquals("US$ 42,35", ProTripMoneyPresentation.format(4235L, "USD", "unknown-game", "TOTAL US$ 42,35"));
    }
}
