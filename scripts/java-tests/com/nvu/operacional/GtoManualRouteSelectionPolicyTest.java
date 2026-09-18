package com.nvu.operacional;

import java.util.Arrays;
import java.util.List;

public final class GtoManualRouteSelectionPolicyTest {
    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    public static void main(String[] args) {
        List<String> expected = Arrays.asList(
            "Aguas Velhas",
            "Cooperativa Agro Grão",
            "Cruz do Oeste",
            "Curitiba",
            "Fazenda Areia Dourada",
            "Itapetuna",
            "Lages",
            "Lauro Muller",
            "Nova Macaé",
            "Registro"
        );
        check(expected.equals(GtoManualRouteSelectionPolicy.locations()), "lista não está em ordem alfabética");
        check(GtoManualRouteSelectionPolicy.isValidLocation("Itapetuna"), "Itapetuna deve ser válida");
        check(GtoManualRouteSelectionPolicy.isValidLocation("Matecom") == false, "empresa não pode ser opção de cidade");
        check(GtoManualRouteSelectionPolicy.isValidLocation("Motecom") == false, "alias OCR não pode ser opção");
        check(!GtoManualRouteSelectionPolicy.isValidLocation("itapetuna"), "comparação deve ser literal");
        check(GtoManualRouteSelectionPolicy.ORIGIN_STEP.equals(
            GtoManualRouteSelectionPolicy.nextStep(GtoManualRouteSelectionPolicy.DESTINATION_STEP)
        ) == false, "destino não pode retornar origem");
        check(GtoManualRouteSelectionPolicy.DESTINATION_STEP.equals(
            GtoManualRouteSelectionPolicy.nextStep(GtoManualRouteSelectionPolicy.ORIGIN_STEP)
        ), "origem deve avançar para destino");
        check(GtoManualRouteSelectionPolicy.labelForStep(GtoManualRouteSelectionPolicy.ORIGIN_STEP).equals("origem"), "label de origem inválido");
        check(GtoManualRouteSelectionPolicy.labelForStep(GtoManualRouteSelectionPolicy.DESTINATION_STEP).equals("destino"), "label de destino inválido");
        System.out.println("GtoManualRouteSelectionPolicyTest: PASS 9/9");
    }
}
