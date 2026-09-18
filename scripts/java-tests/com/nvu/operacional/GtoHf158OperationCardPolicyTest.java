package com.nvu.operacional;

public final class GtoHf158OperationCardPolicyTest {
    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    private static GtoOperationCardPolicy.ContextSnapshot context(
        String jobId,
        String operationName,
        String contractName,
        int progress,
        int total,
        String vehicle,
        String trailer,
        long revision
    ) {
        return new GtoOperationCardPolicy.ContextSnapshot(
            jobId,
            "driver-001",
            "company-001",
            "contract-001",
            operationName,
            contractName,
            "IN_PROGRESS",
            progress,
            total,
            vehicle,
            trailer,
            revision
        );
    }

    public static void main(String[] args) {
        GtoOperationCardPolicy.ContextSnapshot active = context(
            "job-hf158-001", "BS - 10", "Contrato BS - 10",
            2, 10, "Iveco S Way", "Bau 3 eixos", 8L
        );
        GtoOperationCardPolicy.ContextSnapshot dedicated = context(
            "job-hf158-001", "BS - 10", "Contrato BS - 10",
            2, 10, "Iveco S Way", "Bau 3 eixos", 8L
        );

        GtoOperationCardPolicy.Resolution complete = GtoOperationCardPolicy.resolve(
            active, dedicated, active, null
        );
        require(GtoOperationCardPolicy.AUTH_DEDICATED.equals(complete.authority),
            "current dedicated snapshot must be authoritative");
        require(("Operação BS - 10\n"
            + "Viagens 02/10\n"
            + "Veículo Iveco S Way\n"
            + "Reboque Bau 3 eixos\n"
            + "Progresso 20%").equals(GtoOperationCardPolicy.renderSummary(complete.snapshot)),
            "real operation fixture must render exactly");

        GtoOperationCardPolicy.ContextSnapshot staleRevision = context(
            "job-hf158-001", "Operação antiga", "Contrato antigo",
            1, 10, "Veículo antigo", "Reboque antigo", 7L
        );
        GtoOperationCardPolicy.Resolution recoveredFromLive = GtoOperationCardPolicy.resolve(
            active, staleRevision, active, null
        );
        require(GtoOperationCardPolicy.AUTH_LIVE.equals(recoveredFromLive.authority),
            "stale dedicated revision must never hide the current live commit");
        require(GtoOperationCardPolicy.renderSummary(recoveredFromLive.snapshot).contains("BS - 10"),
            "live recovery must retain the real operation name");

        GtoOperationCardPolicy.Resolution beforeFreightAcceptance = GtoOperationCardPolicy.resolve(
            active, null, active, null
        );
        require(GtoOperationCardPolicy.AUTH_LIVE.equals(beforeFreightAcceptance.authority),
            "operation must render before any freight/session snapshot exists");

        GtoOperationCardPolicy.Resolution afterProcessRestart = GtoOperationCardPolicy.resolve(
            active, dedicated, active, null
        );
        require(GtoOperationCardPolicy.AUTH_DEDICATED.equals(afterProcessRestart.authority),
            "dedicated snapshot must survive process recreation");

        GtoOperationCardPolicy.ContextSnapshot jobB = context(
            "job-hf158-002", "BS - 11", "Contrato BS - 11",
            0, 12, "Volvo FH", "Graneleiro", 9L
        );
        GtoOperationCardPolicy.Resolution switchedJob = GtoOperationCardPolicy.resolve(
            jobB, dedicated, jobB, staleRevision
        );
        require(GtoOperationCardPolicy.AUTH_LIVE.equals(switchedJob.authority),
            "job switch must reject every snapshot belonging to job A");
        require(!GtoOperationCardPolicy.renderSummary(switchedJob.snapshot).contains("BS - 10"),
            "job A data must never leak into job B card");

        GtoOperationCardPolicy.ContextSnapshot compatibleSession = context(
            "job-hf158-001", "BS - 10", "Contrato BS - 10",
            2, 10, "Iveco S Way", "Bau 3 eixos", 3L
        );
        GtoOperationCardPolicy.ContextSnapshot liveWithoutName = context(
            "job-hf158-001", "", "",
            2, 10, "Iveco S Way", "Bau 3 eixos", 8L
        );
        GtoOperationCardPolicy.Resolution sessionFallback = GtoOperationCardPolicy.resolve(
            active, null, liveWithoutName, compatibleSession
        );
        require(GtoOperationCardPolicy.AUTH_SESSION.equals(sessionFallback.authority),
            "compatible session snapshot remains the last fallback");

        GtoOperationCardPolicy.ContextSnapshot companyOnly = context(
            "job-hf158-001", "", "",
            2, 10, "Iveco S Way", "Bau 3 eixos", 8L
        );
        GtoOperationCardPolicy.Resolution noInventedOperation = GtoOperationCardPolicy.resolve(
            active, companyOnly, companyOnly, null
        );
        require(GtoOperationCardPolicy.AUTH_NONE.equals(noInventedOperation.authority),
            "operation cannot be invented from company or an empty contract");

        System.out.println("GtoHf158OperationCardPolicyTest: PASS");
    }
}
