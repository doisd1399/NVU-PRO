package com.nvu.operacional;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

/** Money parsing invariants used by both native OCR and trip submission. */
public class GtoMoneyValueRegressionTest {
    @Test public void parsesBrazilianThousands() {
        assertEquals(Long.valueOf(1616600L), GtoMoneyValue.parseCents("R$ 16.166,00"));
    }

    @Test public void parsesPlainDecimal() {
        assertEquals(Long.valueOf(9990L), GtoMoneyValue.parseCents("99,90"));
    }

    @Test public void acceptsSubHundredPayouts() {
        assertEquals(Long.valueOf(9990L), GtoMoneyValue.parseCents("R$ 99,90"));
        assertEquals("R$ 99,90", GtoMoneyValue.canonical("R$ 99,90"));
    }

    @Test public void rejectsNegativeValues() {
        assertNull(GtoMoneyValue.parseCents("-16.166,00"));
    }
}
