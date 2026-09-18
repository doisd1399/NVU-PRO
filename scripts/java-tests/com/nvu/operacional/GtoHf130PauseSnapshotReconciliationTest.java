package com.nvu.operacional;

public final class GtoHf130PauseSnapshotReconciliationTest {
    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
        System.out.println("PASS " + message);
    }

    public static void main(String[] args) {
        check(GtoPauseCorrectionPolicy.sameSelectedFreightAnchors(
            0, 0,
            "Bebidas", "Bebidas",
            "600Km", "600 km",
            "R$ 10.400,00", "10400"
        ), "Pause validado mantém os âncoras do mesmo frete");
        check(!GtoPauseCorrectionPolicy.sameSelectedFreightAnchors(
            0, 1,
            "Bebidas", "Bebidas",
            "600Km", "600Km",
            "R$ 10.400,00", "R$ 10.400,00"
        ), "linha diferente nunca reconcilia snapshot");
        check(!GtoPauseCorrectionPolicy.sameSelectedFreightAnchors(
            0, 0,
            "Bebidas", "Soja",
            "600Km", "600Km",
            "R$ 10.400,00", "R$ 10.400,00"
        ), "carga diferente nunca reconcilia snapshot");
        check(!GtoPauseCorrectionPolicy.sameSelectedFreightAnchors(
            0, 0,
            "Bebidas", "Bebidas",
            "600Km", "1100Km",
            "R$ 10.400,00", "R$ 10.400,00"
        ), "distância diferente nunca reconcilia snapshot");
        check(!GtoPauseCorrectionPolicy.sameSelectedFreightAnchors(
            0, 0,
            "Bebidas", "Bebidas",
            "600Km", "600Km",
            "R$ 10.400,00", "R$ 19.900,00"
        ), "valor diferente nunca reconcilia snapshot");

        check("Cruz do Oeste".equals(GtoAcceptedFreightFieldPolicy.acceptedVisibleOrigin(
            "Fazenda Areia Dourada", "Cruz do Oeste", "Cooper Log", true, true
        )), "Pause validado controla a origem operacional atual");
        check("Nova Macaé".equals(GtoAcceptedFreightFieldPolicy.acceptedVisibleDestination(
            "Agro Grão Area Rural", "Nova Macaé", "Supermercado Santo Antonio", "", "", "", true
        )), "Pause validado controla o destino operacional atual");
        check("Fazenda Areia Dourada".equals(GtoAcceptedFreightFieldPolicy.acceptedVisibleOrigin(
            "Fazenda Areia Dourada", "Cruz do Oeste", "Cooper Log", true
        )), "Pause sem validação preserva autoridade da Lista aceita");
        check("Agro Grão Area Rural".equals(GtoAcceptedFreightFieldPolicy.acceptedVisibleDestination(
            "Agro Grão Area Rural", "Nova Macaé", "Supermercado Santo Antonio", "", "", ""
        )), "Pause sem validação preserva destino completo da Lista aceita");
        check("Cooper Log".equals(GtoPauseLocationParser.extractBeforeLastSeparator(
            "Cooper Log – Cruz do Oeste"
        )), "parser do Pause extrai a empresa da mesma linha");
        check("Cruz do Oeste".equals(GtoPauseLocationParser.extractAfterLastSeparator(
            "Cooper Log – Cruz do Oeste"
        )), "parser do Pause continua extraindo somente a localidade");
        check(GtoPauseLocationParser.extractAfterLastSeparator("Cooper Log Cruz do Oeste").isEmpty(),
            "parser do Pause não adivinha localidade sem separador");

        System.out.println("HF130 pause snapshot reconciliation behavior passes");
    }
}
