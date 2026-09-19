# NVU PRO — hardening do fluxo Pro

## Escopo

A correção endurece o fluxo Android Pro para que a captura nativa somente prossiga quando o OCR identificar uma tela de resultado compatível e um valor monetário associado ao campo esperado. O caso de regressão validado é `Concluído / Valor a receber: R$ 30.138,00 / Receber / Dobrar valor (ADS)`, cujo valor base é `30138.00`; a oferta de anúncio não é tratada como bônus aplicado.

## Alterações

O `SimpleAutomationService` agora rejeita texto legível arbitrário, como HUD, antes do handoff, exige marcador de resultado e candidato monetário, e preserva o texto somente quando essa pré-validação passa. Falhas da submissão nativa permanecem no estado capturado, são marcadas como retry pendente e são reprocessadas pelo serviço foreground existente a cada 15 segundos, com guarda contra submissões concorrentes. O fallback Web continua disponível e a idempotência do coordenador impede duplicação.

O snapshot nativo de operação agora é monotônico para o mesmo job: uma atualização antiga não pode reduzir o progresso já confirmado nem reabrir uma operação terminal. O plugin Android expõe o estado de retry para diagnóstico.

A lista de funcionários passou a usar exclusivamente `companyMembers` ativos como autoridade de vínculo. O fallback baseado apenas em `users.companyId` foi removido, `fetchedMissingUsers` é filtrado antes de formar `combinedUsers` quando o snapshot de memberships está pronto, e a remoção confirmada limpa imediatamente as projeções locais.

## Validação

| Gate | Resultado |
|---|---|
| Teste estrutural de hardening | PASS |
| Política de recibo, incluindo `R$ 30.138,00` | PASS |
| Adapters Pro TOE3/GTO/WTDS/WBDS | PASS |
| Registro nativo imediato e idempotência | PASS |
| Snapshot de operação | PASS |
| ESLint, build Web e Capacitor sync | PASS |
| Verificação de assets Web/Android | PASS |
| Verificação OTA local | PASS |
| Gradle `assembleRelease` | PASS |
| Assinatura APK v2 | PASS |

O APK corrigido foi compilado com `versionCode 359`, `versionName 1.0.359`, package `com.nvu.operacional` e fingerprint SHA-256 do certificado `806A03EA92B69E7F9A70526E9C4D6A4AE52EC4F9CF7CAC05DDB1AA28084246EA`. O artefato permanece fora do Git; o keystore e o Firebase também não são versionados.
