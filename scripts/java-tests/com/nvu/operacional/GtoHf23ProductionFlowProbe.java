package com.nvu.operacional;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

public final class GtoHf23ProductionFlowProbe {
    private static final class Freight {
        final String cargo, origin, destinationCompany, destination, km, offered, finalValue;
        Freight(String cargo, String origin, String destinationCompany, String destination, String km, String offered, String finalValue) {
            this.cargo = cargo; this.origin = origin; this.destinationCompany = destinationCompany;
            this.destination = destination; this.km = km; this.offered = offered; this.finalValue = finalValue;
        }
    }

    public static void main(String[] args) {
        testFourProductionBlockers();
        testFiveFreightEndToEndModel();
        testReplacementSafety();
        System.out.println("GtoHf23ProductionFlowProbe: PASS");
    }

    private static void testFourProductionBlockers() {
        GtoCityTextResolver.Resolution literal = GtoCityTextResolver.resolveTrusted(
            "Itapetuno", "Itapetuna", Arrays.asList("Itapetuna", "Curitiba")
        );
        require("Itapetuno".equals(literal.value) && !literal.corrected,
            "destination must remain literal; known-city near match cannot rewrite OCR");

        List<GtoOriginGeometryPolicy.RowLine> lines = new ArrayList<>();
        lines.add(new GtoOriginGeometryPolicy.RowLine("CARGA TIJOLO", 12, 32, 80, 250));
        lines.add(new GtoOriginGeometryPolicy.RowLine("600Km", 47, 65, 430, 510));
        lines.add(new GtoOriginGeometryPolicy.RowLine("Fábrica de Tijolo", 58, 78, 80, 260));
        lines.add(new GtoOriginGeometryPolicy.RowLine("Dalavan", 82, 100, 300, 390));
        lines.add(new GtoOriginGeometryPolicy.RowLine("Área Rural", 124, 146, 80, 210));
        lines.add(new GtoOriginGeometryPolicy.RowLine("R$ 11.600", 130, 148, 430, 540));
        lines.add(new GtoOriginGeometryPolicy.RowLine("Aceitar", 152, 174, 520, 620));
        GtoOriginGeometryPolicy.Result origin = GtoOriginGeometryPolicy.inferFromRowLines(lines, "Dalavan", 0, 180);
        require(origin.strong && "Fábrica de Tijolo".equals(origin.value),
            "origin ROI must exclude 600Km/R$/Aceitar and keep the selected-row origin");

        require("CONFIRMING_FREIGHT".equals(GtoSessionRecoveryPolicy.restoredState(
            "CONFIRMING_FREIGHT", "CONFIRMED", "REVIEW_REQUIRED", "ORIGIN_COMPANY", "precise-touch")),
            "human-backed confirmed field review must survive process death");
        require("WAITING_FREIGHT".equals(GtoSessionRecoveryPolicy.restoredState(
            "CONFIRMING_FREIGHT", "CONFIRMED", "REVIEW_REQUIRED", "ORIGIN_COMPANY", "frame-lock")),
            "legacy visual-only field review must not survive process death as selected freight");
        require("WAITING_FREIGHT".equals(GtoSessionRecoveryPolicy.restoredState(
            "CONFIRMING_FREIGHT", "TOUCH_LOCKED", "", "")),
            "unconfirmed touch candidate may safely return to waiting after process death");
        long threeDays = 3L * 24L * 60L * 60L * 1000L;
        long twelveHours = 12L * 60L * 60L * 1000L;
        require(GtoSessionRecoveryPolicy.keepDurableSession(true, threeDays, twelveHours),
            "valid durable trip must survive beyond 12h");
        require(!GtoSessionRecoveryPolicy.keepDurableSession(false, 1L, twelveHours),
            "missing durable snapshot cannot be revived by age policy");
    }

    private static void testFiveFreightEndToEndModel() {
        Freight[] freights = new Freight[] {
            new Freight("SOJA", "Agro Vale", "Coop Sul", "Curitiba", "420Km", "R$ 5.300", "R$ 5.300,00"),
            new Freight("MILHO", "Fazenda Horizonte", "Armazém Norte", "Lages", "510Km", "R$ 6.900", "R$ 6.900"),
            new Freight("CARGA TIJOLO", "Fábrica de Tijolo", "Dalavan", "Área Rural", "600Km", "R$ 11.600", "R$ 11.600"),
            new Freight("CERÂMICAS", "Cerâmica Central", "Depósito Oeste", "Cruz do Oest", "600Km", "R$ 5.300", "R$ 5.300"),
            new Freight("MADEIRA", "Serraria União", "Pátio Serra", "Lauro Muler", "730Km", "R$ 15.200", "R$ 15.200")
        };

        String state = "IDLE";
        Set<String> sentFingerprints = new HashSet<>();
        for (int i = 0; i < freights.length; i++) {
            Freight f = freights[i];
            require(GtoDeterministicFlowPolicy.isAllowedTripTransition(state, "WAITING_FREIGHT"), "init/wait transition " + i);
            state = "WAITING_FREIGHT";

            require(GtoSelectionEvidencePolicy.mayConfirmSelection(true, i, freights.length),
                "real driver action must authorize freight row " + i);
            require(GtoFreightSemanticCertificationPolicy.isCertifiedPage(
                freights.length, freights.length, freights.length
            ), "Aceitar + money page certification must pass for freight " + i);
            require(GtoFreightSemanticCertificationPolicy.selectedRowCanCertify(
                true, true, f.cargo, f.origin, f.destination, f.km, f.offered
            ), "selected row must carry Aceitar + money/context evidence for freight " + i);
            int selected = GtoSelectionIdentityPolicy.resolveExactTouchAfterTransition(i, freights.length, true, -1);
            require(selected == i, "touch must confirm exact freight row " + i);
            require(GtoDeterministicFlowPolicy.isAllowedTripTransition(state, "CONFIRMING_FREIGHT"), "wait/confirm transition " + i);
            state = "CONFIRMING_FREIGHT";

            // Reproduce the selected-row OCR geometry for every freight, including metric
            // labels in the same crop. Origem must remain the left route text only.
            List<GtoOriginGeometryPolicy.RowLine> rowLines = new ArrayList<>();
            rowLines.add(new GtoOriginGeometryPolicy.RowLine(f.cargo, 12, 32, 80, 250));
            rowLines.add(new GtoOriginGeometryPolicy.RowLine(f.km, 47, 65, 430, 510));
            rowLines.add(new GtoOriginGeometryPolicy.RowLine(f.origin, 58, 78, 80, 280));
            if (!f.destinationCompany.isEmpty()) rowLines.add(new GtoOriginGeometryPolicy.RowLine(f.destinationCompany, 82, 100, 300, 410));
            rowLines.add(new GtoOriginGeometryPolicy.RowLine(f.destination, 124, 146, 80, 250));
            rowLines.add(new GtoOriginGeometryPolicy.RowLine(f.offered, 130, 148, 430, 550));
            rowLines.add(new GtoOriginGeometryPolicy.RowLine("Aceitar", 152, 174, 520, 620));
            GtoOriginGeometryPolicy.Result originResult = GtoOriginGeometryPolicy.inferFromRowLines(rowLines, f.destinationCompany, 0, 180);
            require(originResult.strong && f.origin.equals(originResult.value), "origin geometry must pass for freight " + i + ": " + originResult.value);

            GtoCityTextResolver.Resolution literalDestination = GtoCityTextResolver.resolveTrusted(
                f.destination, "", Arrays.asList("Curitiba", "Lages", "Cruz do Oeste", "Lauro Muller")
            );
            require(f.destination.equals(literalDestination.value) && !literalDestination.corrected,
                "destination must stay literal for freight " + i);

            String pending = GtoFreightReviewPolicy.firstRequiredField(
                f.cargo, f.origin, f.destinationCompany, f.destination, f.km, f.offered
            );
            require(pending.isEmpty(), "all required fields must be usable for freight " + i + ": " + pending);
            require(GtoDeterministicFlowPolicy.isAllowedTripTransition(state, "TRIP_IN_PROGRESS"), "confirm/trip transition " + i);
            state = "TRIP_IN_PROGRESS";

            // Result screen: semantic result + two independent monetary observations.
            require(GtoMoneyValue.parseCents(f.finalValue) != null, "final money parse " + i);
            String evidence = "";
            GtoResultValueConsensus.Decision d1 = GtoResultValueConsensus.observe(evidence, "ocr:" + i + ":1", f.finalValue, "");
            GtoResultValueConsensus.Decision d2 = GtoResultValueConsensus.observe(d1.evidence, "ocr:" + i + ":2", f.finalValue, "");
            require(!d2.stableValue.isEmpty() && !d2.conflict, "result value consensus " + i);
            require(GtoDeterministicFlowPolicy.isAllowedTripTransition(state, "RESULT_DETECTED"), "trip/result transition " + i);
            state = "RESULT_DETECTED";
            require(GtoDeterministicFlowPolicy.isAllowedTripTransition(state, "RESULT_CONFIRMED"), "receive/confirmed transition " + i);
            state = "RESULT_CONFIRMED";

            String fingerprint = f.cargo + "|" + f.origin + "|" + f.destination + "|" + f.km + "|" + GtoMoneyValue.canonical(f.finalValue);
            require(sentFingerprints.add(fingerprint), "automatic send fingerprint must be unique " + i);

            if (i < freights.length - 1) {
                require(GtoDeterministicFlowPolicy.shouldAutoPrepareNextFreightAfterSync(state, true, false),
                    "ACK must prepare next freight " + i);
                state = "WAITING_FREIGHT";
            }
        }
        require(sentFingerprints.size() == 5, "all five distinct trips must reach automatic send exactly once");
    }

    private static void testReplacementSafety() {
        require(!GtoDeterministicFlowPolicy.mayReplaceActiveTrip("TRIP_IN_PROGRESS", false),
            "one unconfirmed list frame cannot replace active trip");
        require(GtoDeterministicFlowPolicy.mayReplaceActiveTrip("TRIP_IN_PROGRESS", true),
            "stable jobs-list return may close the stale trip before the new Accept");
        int newSelected = GtoSelectionIdentityPolicy.resolveExactTouchAfterTransition(4, 5, true, -1);
        require(newSelected == 4, "replacement touch must select only the new row");
    }

    private static void require(boolean ok, String message) {
        if (!ok) throw new AssertionError(message);
    }
}
