package com.nvu.operacional;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class PendingTripFailurePolicyTest {
    @Test
    public void terminalClosedOperationPreconditionIsPermanentAndNotReconciliation() {
        String reason = "GTO_PRO_REGISTRATION_FAILED:FAILED_PRECONDITION:Operação não iniciada ou não disponível.";
        assertTrue(PendingTripFailurePolicy.isTerminalOperationRejection(reason));
        assertTrue(PendingTripFailurePolicy.isPermanentRejection(reason));
        assertFalse(PendingTripFailurePolicy.isReconciliationRequired(reason));
    }

    @Test
    public void accentsAndEnglishTerminalMessagesAreRecognized() {
        assertTrue(PendingTripFailurePolicy.isTerminalOperationRejection(
            "FAILED_PRECONDITION: Operacao nao iniciada ou nao disponivel"));
        assertTrue(PendingTripFailurePolicy.isTerminalOperationRejection(
            "FAILED_PRECONDITION: Operation completed"));
    }

    @Test
    public void explicitReconciliationRejectionIsNotTerminal() {
        String reason = "FAILED_PRECONDITION: reserva operacional sem histórico confirmado";
        assertTrue(PendingTripFailurePolicy.isReconciliationRequired(reason));
        assertFalse(PendingTripFailurePolicy.isTerminalOperationRejection(reason));
        assertFalse(PendingTripFailurePolicy.isPermanentRejection(reason));
    }

    @Test
    public void genericFailedPreconditionDoesNotTriggerTerminalOrReconciliationGuess() {
        String reason = "FAILED_PRECONDITION: Condição temporariamente indisponível";
        assertFalse(PendingTripFailurePolicy.isTerminalOperationRejection(reason));
        assertFalse(PendingTripFailurePolicy.isReconciliationRequired(reason));
    }
}
