package com.nvu.operacional;

import java.util.Arrays;

public final class GtoCertifiedAuthorityContractTest {
    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    public static void main(String[] args) {
        String metalurgica = GtoAcceptedFreightFieldPolicy.acceptedVisibleOrigin(
            "Metalurgica", "Metalurgica", "Metalurgica", false
        );
        String matecom = GtoAcceptedFreightFieldPolicy.acceptedVisibleDestination(
            "Matecom Itapetuna", "Matecom Itapetuna", "Motecom",
            "Carga X | Metalurgica → Matecom Itapetuna | 300Km | R$ 5.300,00",
            "Metalurgica > Motecom", "Metalurgica", false
        );
        require("Metalurgica".equals(metalurgica), "origem da mesma linha deve permanecer literal");
        require("Matecom Itapetuna".equals(matecom), "destino completo não pode duplicar empresa stale");

        String agro = GtoAcceptedFreightFieldPolicy.destination("Agro Grão Area Rural", "Agro Grão", "");
        String hortifruti = GtoAcceptedFreightFieldPolicy.destination("Hortifruti Águas Velhas", "Hortifruti", "");
        require("Agro Grão Area Rural".equals(agro), "destino rural completo deve permanecer uma vez");
        require("Hortifruti Águas Velhas".equals(hortifruti), "destino em duas linhas deve permanecer completo");

        String staleCompany = GtoAcceptedFreightFieldPolicy.destination(
            "Matecom Itapetuna", "Motecom", "Linha | Metalurgica → Matecom Itapetuna"
        );
        require("Matecom Itapetuna".equals(staleCompany), "empresa divergente não pode substituir a linha selecionada");

        String localityOnly = GtoAcceptedFreightFieldPolicy.destination("Area Rural", "Agro Grão", "");
        require("Agro Grão Area Rural".equals(localityOnly), "localidade isolada pode ser recomposta apenas no contrato Lista");

        String official = GtoCityTextResolver.uniqueOfficialCanonicalCandidate(
            "Itopetuna", Arrays.asList("Itapetuna")
        );
        require("Itapetuna".equals(official), "Itopetuna só admite candidato oficial único na Lista");
        require(GtoCityTextResolver.uniqueOfficialCanonicalCandidate(
            "Itopetuna", Arrays.asList("Itapetuna", "Itopetana")
        ).isEmpty(), "correção ambígua deve ser bloqueada, sem escolher um candidato");

        String pauseLiteral = GtoAcceptedFreightFieldPolicy.destination("Itopetuna", "", "");
        require("Itopetuna".equals(pauseLiteral), "Pause não pode receber correção de cidade da Lista");
    }
}
