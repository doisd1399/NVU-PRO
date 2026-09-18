package com.nvu.operacional;

public final class GtoHf129OriginAndCompactVisualTest {
    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
        System.out.println("PASS " + message);
    }

    public static void main(String[] args) {
        String expected = "Fazenda Areia Dourada";
        String wrongOcr = "Fazenda Areia Douradg";
        String pauseOrigin = "Area Rural";

        check(
            expected.equals(GtoAcceptedFreightFieldPolicy.acceptedVisibleOrigin(
                expected, wrongOcr, expected, false
            )),
            "origem literal da lista vence OCR operacional incorreto"
        );
        check(
            expected.equals(GtoAcceptedFreightFieldPolicy.acceptedVisibleOrigin(
                "", "", expected, false
            )),
            "origem da rota é promovida quando o campo operacional está vazio"
        );
        check(
            expected.equals(GtoAcceptedFreightFieldPolicy.acceptedVisibleOrigin(
                expected, pauseOrigin, "Pause Company", true
            )),
            "autoridade visual da lista sobrevive sem alterar o contrato interno do Pause"
        );
        check(
            pauseOrigin.equals(GtoAcceptedFreightFieldPolicy.acceptedVisibleOrigin(
                "", pauseOrigin, "Pause Company", true
            )),
            "Pause sem autoridade da lista mantém sua própria localidade"
        );
        check(
            expected.equals(GtoAcceptedFreightFieldPolicy.origin("", expected)),
            "compatibilidade da promoção histórica da origem é preservada"
        );
        check(
            "Agro Grão Area Rural".equals(
                GtoAcceptedFreightFieldPolicy.destination("Area Rural", "Agro Grão")
            ),
            "correção atual de destino completo permanece preservada"
        );
    }
}
