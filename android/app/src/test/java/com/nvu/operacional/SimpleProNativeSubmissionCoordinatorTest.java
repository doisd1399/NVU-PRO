package com.nvu.operacional;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;

import org.junit.Test;

/** Regression for first-attempt result validation. */
public class SimpleProNativeSubmissionCoordinatorTest {
    @Test
    public void preservesToeCurrencyAndWholePayout() {
        SimpleProNativeSubmissionCoordinator.Receipt receipt =
            SimpleProNativeSubmissionCoordinator.parseReceipt("toe-3", "RENDA TOTAL: USD 6,547");
        assertNotNull(receipt);
        assertEquals(654700, receipt.amountCents);
        assertEquals("USD", receipt.currency);
    }
    @Test
    public void keepsAValidPayoutWhenCurrencyIsNotExplicit() {
        SimpleProNativeSubmissionCoordinator.Receipt receipt =
            SimpleProNativeSubmissionCoordinator.parseReceipt("toe-3", "RENDA TOTAL: 6,547");
        assertNotNull(receipt);
        assertEquals(654700, receipt.amountCents);
        assertEquals("", receipt.currency);
    }
    @Test
    public void parsesAmountWhenOcrSeparatesLabelButtonsCurrencyAndAmount() {
        SimpleProNativeSubmissionCoordinator.Receipt receipt =
            SimpleProNativeSubmissionCoordinator.parseReceipt(
                "global-truck",
                "Concluido Valor a receber:\nReceber\nDobrar valor (ADS)\nR$\n6.547,00"
            );
        assertNotNull("native parser must recover a valid result without a second user attempt", receipt);
        assertEquals(654700, receipt.amountCents);
    }

    @Test
    public void acceptsStaticAdsOfferWithoutTreatingItAsDoubledValue() {
        SimpleProNativeSubmissionCoordinator.Receipt receipt =
            SimpleProNativeSubmissionCoordinator.parseReceipt(
                "global-truck",
                "Concluido Valor a receber: R$ 6.547,00 Receber Dobrar valor (ADS)"
            );
        assertNotNull(receipt);
        assertEquals(654700, receipt.amountCents);
    }

    @Test
    public void classifiesFirestoreSdkCodesForQueueDiagnosis() {
        assertEquals("PERMISSION_DENIED", SimpleProNativeSubmissionCoordinator.classifyFirestoreCode("PERMISSION_DENIED"));
        assertEquals("UNAUTHENTICATED", SimpleProNativeSubmissionCoordinator.classifyFirestoreCode("UNAUTHENTICATED"));
        assertEquals("NETWORK_TRANSIENT", SimpleProNativeSubmissionCoordinator.classifyFirestoreCode("UNAVAILABLE"));
        assertEquals("FAILED_PRECONDITION", SimpleProNativeSubmissionCoordinator.classifyFirestoreCode("FAILED_PRECONDITION"));
    }
}
