package com.nvu.operacional;

import java.util.Arrays;
import java.util.List;

public final class GtoHf128FirstRowDirectPromotionTest {
    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
        System.out.println("PASS " + message);
    }

    private static GtoFreightFieldConflictPolicy.Resolution textField(
        String field, String value
    ) {
        return GtoFreightFieldConflictPolicy.resolveWithFocusedReads(
            field, "", "", value, value
        );
    }

    public static void main(String[] args) {
        GtoFreightFieldConflictPolicy.Resolution cargo = textField(
            GtoFreightReviewPolicy.CARGO, "Soja"
        );
        GtoFreightFieldConflictPolicy.Resolution origin = textField(
            GtoFreightReviewPolicy.ORIGIN_COMPANY, "Fazenda Areia Dourada"
        );
        GtoFreightFieldConflictPolicy.Resolution destination = textField(
            GtoFreightReviewPolicy.DESTINATION, "Agro Grão Área Rural"
        );
        GtoFreightFieldConflictPolicy.Resolution distance = textField(
            GtoFreightReviewPolicy.DISTANCE, "1100Km"
        );
        GtoFreightFieldConflictPolicy.Resolution value =
            GtoFreightFieldConflictPolicy.resolveWithFocusedReads(
                GtoFreightReviewPolicy.VALUE, "", "", "R$ 19.900,00", "R$ 19900"
            );

        check(cargo.resolved && "Soja".equals(cargo.value), "primeiro frete confirma carga Soja");
        check(origin.resolved && "Fazenda Areia Dourada".equals(origin.value), "primeiro frete confirma origem operacional");
        check(destination.resolved && "Agro Grão Área Rural".equals(destination.value), "primeiro frete preserva destino completo da lista");
        check(distance.resolved, "primeiro frete confirma distância 1100Km");

        String hortifrutiDestination = GtoAcceptedFreightFieldPolicy.destination("Águas Velhas", "Hortifruti");
        String agroGraoDestination = GtoAcceptedFreightFieldPolicy.destination("Area Rural", "Agro Grão");
        check(
            "Hortifruti Águas Velhas".equals(hortifrutiDestination),
            "lista aceita concatena Hortifruti + Águas Velhas no destino operacional"
        );
        check(
            "Agro Grão Area Rural".equals(agroGraoDestination),
            "lista aceita concatena Agro Grão + Area Rural no destino operacional"
        );
        check(
            "Agro Grão Area Rural".equals(
                GtoAcceptedFreightFieldPolicy.destination(agroGraoDestination, "Agro Grão")
            ),
            "composição do destino da lista é idempotente"
        );
        check(
            "Agro Grão Area Rural".equals(
                GtoAcceptedFreightFieldPolicy.destination(
                    "Area Rural",
                    "",
                    "Soja\nFazenda Areia Dourada > Agro Grão\nArea Rural"
                )
            ),
            "lista recupera Agro Grão do texto bruto quando o metadata é perdido"
        );
        check(
            "Hortifruti Águas Velhas".equals(
                GtoAcceptedFreightFieldPolicy.destination(
                    "Águas Velhas",
                    "",
                    "Ovos Codorna\nFazenda Areia Dourada > Hortifruti\nÁguas Velhas"
                )
            ),
            "lista recupera Hortifruti do texto bruto quando o metadata é perdido"
        );
        check(
            "Agro Grão Area Rural".equals(
                GtoAcceptedFreightFieldPolicy.acceptedVisibleDestination(
                    "", "Area Rural", "", "", "Fazenda Areia Dourada > Agro Grão"
                )
            ),
            "card recupera Agro Grão do companyRoute quando o campo separado foi perdido"
        );
        check(
            "Agro Grão Area Rural".equals(
                GtoAcceptedFreightFieldPolicy.acceptedVisibleDestination(
                    "Agro Grão Area Rural", "Area Rural", "Pause Company", "", ""
                )
            ),
            "destino visível persistido da lista vence a leitura posterior do Pause"
        );
        check(
            "Agro Grão Area Rural".equals(
                GtoAcceptedFreightFieldPolicy.acceptedVisibleDestination(
                    "Area Rural",
                    "Area Rural",
                    "",
                    "Soja | Fazenda Areia Dourada | Agro Grão | Area Rural",
                    "",
                    "Fazenda Areia Dourada"
                )
            ),
            "snapshot legado localidade-only recupera Agro Grão do rawText persistido"
        );
        check(
            "Area Rural".equals(
                GtoAcceptedFreightFieldPolicy.acceptedVisibleDestination(
                    "Area Rural", "Area Rural", "", "", "", "Fazenda Areia Dourada"
                )
            ),
            "sem evidência de rota o destino não é adivinhado"
        );
        check(value.resolved, "primeiro frete confirma valor R$ 19.900,00");

        check(GtoFreightFieldEvidencePolicy.text(cargo.value, 2, true), "carga tem evidência automática segura");
        check(GtoFreightFieldEvidencePolicy.text(origin.value, 2, true), "origem tem evidência automática segura");
        check(GtoFreightFieldEvidencePolicy.text(destination.value, 2, true), "destino tem evidência automática segura");
        check(GtoFreightFieldEvidencePolicy.distance(distance.value, 2, true), "distância tem evidência automática segura");
        check(GtoFreightFieldEvidencePolicy.money(value.value, 2, true), "valor tem evidência automática segura");

        check(
            GtoFreightSelectionPolicy.canCommitCanonicalRow(
                0, 0, true, "1100Km", "R$ 19900", "1100Km", "R$ 19.900,00"
            ),
            "primeiro frete completo pode promover diretamente após Aceitar"
        );
        check(
            !GtoFreightSelectionPolicy.canCommitCanonicalRow(
                0, 0, true, "900Km", "R$ 19900", "1100Km", "R$ 19.900,00"
            ),
            "conflito numérico real continua bloqueado"
        );

        List<GtoOriginGeometryPolicy.RowLine> brokenRoute = Arrays.asList(
            new GtoOriginGeometryPolicy.RowLine("Soja", 8, 22, 0, 70),
            new GtoOriginGeometryPolicy.RowLine("Fazenda Areia", 34, 48, 0, 120),
            new GtoOriginGeometryPolicy.RowLine("Dourada > Agro Grão", 50, 64, 0, 180),
            new GtoOriginGeometryPolicy.RowLine("Área Rural", 70, 84, 0, 95)
        );
        GtoOriginGeometryPolicy.Result recoveredOrigin =
            GtoOriginGeometryPolicy.inferFromExpectedOriginPrefix(
                brokenRoute, "Fazenda Areia Dourada", 0, 100
            );
        check(
            recoveredOrigin.strong && "Fazenda Areia Dourada".equals(recoveredOrigin.value),
            "primeiro frete recupera origem literal mesmo com rota quebrada pelo OCR"
        );
        String operationalOrigin = GtoAcceptedFreightFieldPolicy.origin("", recoveredOrigin.value);
        check(
            "Fazenda Areia Dourada".equals(operationalOrigin),
            "origem recuperada geometricamente é promovida ao campo operacional da lista"
        );
        check(
            GtoFreightReviewPolicy.firstRequiredField(
                "Soja", operationalOrigin, "Agro Grão", "Agro Grão Área Rural",
                "1100Km", "R$ 19.900,00"
            ).isEmpty(),
            "frete 1 tem os cinco campos completos para a promoção direta"
        );
        check(
            !GtoOriginGeometryPolicy.inferFromExpectedOriginPrefix(
                brokenRoute, "Outra Fazenda", 0, 100
            ).strong,
            "origem ativa ausente na linha selecionada não pode ser inventada"
        );

        check(
            GtoFreightSemanticCertificationPolicy.selectedRowCanCertifyAfterHumanTouch(
                true, "Soja", "Fazenda Areia Dourada", "Agro Grão Área Rural", "1100Km", "R$ 19.900,00"
            ),
            "botão visual + toque humano certificam a linha sem OCR redundante de Aceitar"
        );
        check(
            !GtoFreightSemanticCertificationPolicy.selectedRowCanCertify(
                true, false, "Soja", "Fazenda Areia Dourada", "Agro Grão Área Rural", "1100Km", "R$ 19.900,00"
            ),
            "sem toque humano, botão sem texto OCR continua bloqueado"
        );
        check(
            GtoFreightSelectionPolicy.canCommitHumanBackedSelectedRow(
                0, 0, true, true, true, false, false
            ),
            "primeiro row completo com toque humano pode promover diretamente"
        );
        check(
            GtoFreightSelectionPolicy.canCommitHumanBackedSelectedRow(
                0, 0, true, false, true, false, false
            ),
            "toque humano continua válido sem mudança visual posterior do botão"
        );
        check(
            !GtoFreightSelectionPolicy.canCommitHumanBackedSelectedRow(
                0, 0, false, true, true, false, false
            )
            && !GtoFreightSelectionPolicy.canCommitHumanBackedSelectedRow(
                0, 0, true, true, true, false, true
            )
            && !GtoFreightSelectionPolicy.canCommitHumanBackedSelectedRow(
                0, 0, true, true, false, false, false
            )
            && !GtoFreightSelectionPolicy.canCommitHumanBackedSelectedRow(
                0, 1, true, true, true, false, false
            ),
            "sem toque, com conflito, incompleto ou índice diferente o commit direto continua bloqueado"
        );

        check(
            GtoAcceptedFreightFieldPolicy.sameVisibleDestination(
                "Agro Grão Área Rural", "Agro Grão", "Área Rural", "Agro Grão"
            ),
            "frete 1 não gera conflito quando destino combinado e separado são o mesmo cartão"
        );
        check(
            !GtoAcceptedFreightFieldPolicy.sameVisibleDestination(
                "Agro Grão Área Rural", "Agro Grão", "Área Rural", "Outro Destino"
            ),
            "frete 1 mantém conflito quando destino realmente diverge"
        );

        GtoFreightListTextAuthorityPolicy.FreightTextEvidence twoReads =
            new GtoFreightListTextAuthorityPolicy.FreightTextEvidence(
                "Soja", 2,
                "Fazenda Areia Dourada", 2,
                "Agro Grão Área Rural", 2
            );
        check(
            GtoFreightListTextAuthorityPolicy.canDirectPromote(twoReads, false),
            "linha da lista com duas leituras textuais concordantes pode promover diretamente"
        );
        GtoFreightListTextAuthorityPolicy.FreightTextEvidence oneReadCorrupted =
            new GtoFreightListTextAuthorityPolicy.FreightTextEvidence(
                "Soja", 1,
                "Fazenda Areia Dourada", 1,
                "Motecom", 1
            );
        check(
            !GtoFreightListTextAuthorityPolicy.canDirectPromote(oneReadCorrupted, false),
            "uma leitura plausível porém corrompida como Motecom não pode virar autoridade"
        );
        GtoFreightListTextAuthorityPolicy.FreightTextEvidence pauseEvidence =
            new GtoFreightListTextAuthorityPolicy.FreightTextEvidence(
                "Soja", 2,
                "Fazenda Areia Dourada", 2,
                "Agro Grão", 2
            );
        check(
            !GtoFreightListTextAuthorityPolicy.canDirectPromote(pauseEvidence, true),
            "a política de promoção direta da lista nunca se aplica ao Pause"
        );
    }
}

