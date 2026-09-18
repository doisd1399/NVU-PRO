package com.nvu.operacional;

public final class GtoHf165LiteralFreightIntegrityTest {
    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
        System.out.println("PASS: " + message);
    }

    public static void main(String[] args) {
        check(GtoFreightTextGuard.sameLiteralText("Soja", "Soja"),
            "Soja permanece igual quando as leituras concordam literalmente");
        check(!GtoFreightTextGuard.sameLiteralText("Soja", "Sojo"),
            "Soja e Sojo são divergentes sem correção ortográfica");
        check(!GtoFreightTextGuard.sameLiteralText("Soja", "SOJA"),
            "diferença de caixa não é promovida como igualdade operacional");
        check(!GtoFreightTextGuard.sameLiteralText("Metalúrgica", "Metalurgica"),
            "diferença de acento não é apagada no texto operacional");
        check(GtoCargoConsensusPolicy.nextReadCount("Soja", 1, "Sojo") == 1,
            "leitura Sojo reinicia consenso em vez de confirmar Soja");
        check(GtoCargoConsensusPolicy.nextReadCount("Soja", 1, "Soja") == 2,
            "segunda leitura literal Soja confirma somente Soja");

        GtoCargoAuthorityPolicy.Resolution preserved = GtoCargoAuthorityPolicy.resolvePauseCargo(
            "Soja", true, "Sojo", 1
        );
        check(preserved.accepted && preserved.conflict && "Soja".equals(preserved.value),
            "autoridade same-row preserva Soja e registra Sojo apenas como divergência");

        GtoCargoAuthorityPolicy.Resolution pauseOnly = GtoCargoAuthorityPolicy.resolvePauseCargo(
            "", false, "Sojo", 1
        );
        check(!pauseOnly.accepted && pauseOnly.value.isEmpty(),
            "Pause sem autoridade não promove nem expõe uma leitura isolada Sojo");

        GtoCargoAuthorityPolicy.Resolution pauseConsensus = GtoCargoAuthorityPolicy.resolvePauseCargo(
            "", false, "Soja", 2
        );
        check(pauseConsensus.accepted && "Soja".equals(pauseConsensus.value),
            "Pause só promove Soja após duas leituras literais concordantes");

        System.out.println("HF165 literal freight integrity fixture: PASS");
    }
}
