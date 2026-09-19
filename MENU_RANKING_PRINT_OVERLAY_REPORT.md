# Auditoria NVU PRO — Menu, Ranking, Print e overlay Android

## Causas raiz

O toggle falhava porque `DriverLayout` e `AdminLayout` tratavam `nvu-open-shell-menu` como comando imperativo de abertura (`setIsMobileMenuOpen(true)`). O botão do Ranking emitia esse mesmo evento, que não era semanticamente um toggle.

O Ranking não exibia o menu porque `/ranking` era uma rota full-page fora de `DriverLayout` e `AdminLayout`; portanto, não havia uma instância montada de `GlobalMenu` nem listener de shell no caminho normal.

O bloqueio Android era causado por `beginCaptureConsent()` chamando `hideCaptureInteractiveOverlaysKeepBubble()`, que removia o menu, mas deliberadamente mantinha o `bubbleView` criado com `TYPE_APPLICATION_OVERLAY`. Esse bubble podia permanecer sobre a tela protegida de autorização MediaProjection.

## Arquitetura aplicada

`GlobalMenu.tsx` continua sendo a única fonte do menu. Foi adicionada apenas uma camada `RankingShellRoute` em `App.tsx`: ela seleciona o layout ativo (`DriverLayout` ou `AdminLayout`) e injeta `RankingGlobal` como conteúdo do layout. Os layouts aceitam conteúdo embutido e continuam usando a mesma instância de `GlobalMenu`, geometria, overlay e fechamento.

O evento `nvu-toggle-shell-menu` passou a alternar o estado com `setIsMobileMenuOpen((open) => !open)`. O evento legado `nvu-open-shell-menu` permanece como alias com semântica de toggle, evitando que chamadas antigas forcem o estado aberto.

Antes da tela de consentimento MediaProjection, o bubble é removido imediatamente com `removeViewImmediate`, o menu é fechado e `captureUiHidden=true` é persistido. O monitor de visibilidade não recria o bubble enquanto esse estado estiver ativo. Em cancelamento, erro ou autorização recusada, o fluxo existente limpa `captureUiHidden` e restaura o bubble; após autorização concedida o bubble permanece oculto durante a captura. O estado é exposto como diagnóstico seguro pelo plugin: permissão, tipo de overlay, visibilidade, estágio de captura, última ação e erro resumido.

A validação de `Settings.canDrawOverlays()` continua obrigatória antes de `addView`; quando ausente, o serviço registra `overlay-permission` e não tenta criar `TYPE_APPLICATION_OVERLAY`. O tipo moderno não foi substituído por tipos obsoletos.

## Print e valores

Os testes foram executados com `tsx` para o caso `.mjs` que importa módulos TypeScript, não ignorados por incompatibilidade do Node. Todos passaram:

| Teste | Resultado |
|---|---|
| OCR de valores GTO | 10/10 |
| Evidência mínima Print | 8/8 |
| Crop de valor em retrato | 8/8 |
| Evidência Print R3.13 | 12/12 |
| Persistência transacional Print | PASS |

A leitura obrigatória `Valor a receber: R$ 30.138,00` continua produzindo `30138.00`, ou `3013800` centavos. Os casos `R$ 14.800,00`, `R$ 14 800,00`, `14 900 00` e `1480000` também permanecem cobertos. O texto `12:55 5G 90% FPS 31` não é convertido em valor. A oferta isolada `Dobrar valor (ADS)` não bloqueia; somente evidência real de recompensa/dobro confirmado bloqueia.

## Validação executada

O teste estrutural do shell, Ranking e overlay passou. Também passaram o registro nativo imediato e o snapshot de operação. `tsc --noEmit`, lint, build Web, `cap sync`, preparação/verificação de assets e `verify:ota-ready` passaram. O Gradle `assembleRelease` passou.

O APK foi assinado com v2 e validado com package `com.nvu.operacional`, `versionCode 359` e `versionName 1.0.359`. Fingerprint SHA-256 do certificado: `806A03EA92B69E7F9A70526E9C4D6A4AE52EC4F9CF7CAC05DDB1AA28084246EA`.

O teste manual com toques, consentimento MediaProjection, cancelamento e screenshot real não foi executado porque não existe dispositivo ou emulador ADB disponível nesta sessão. Portanto, esse item não é declarado como PASS; o diagnóstico automatizado e o APK estão prontos para essa etapa em dispositivo físico.

## Escopo preservado

Nenhum arquivo de Modo Max, GTO Observer ou detecção de fretes foi alterado. Firebase, regras de fraude e lógica de transporte não foram modificados.
