# NVU — Auditoria de finalização de viagem R1

## Correções implementadas

O fluxo Pro passou a emitir um evento de confirmação após a validação autoritativa e a gravação da viagem. O fluxo Print emite o mesmo evento após o coordenador transacional concluir o lançamento. O evento alimenta um card compacto persistente com **Viagem registrada**, origem, destino e ganhos. O card fica fora dos menus flutuantes, oculta os cartões de menu enquanto estiver ativo, possui fechamento compacto e pode ser removido por arraste lateral. Após o lançamento, é executado áudio em português por `SpeechSynthesis` com a frase “Viagem registrada”.

A proteção transacional de `addTripWithinOperationLimit` compara o valor do lançamento com a viagem imediatamente anterior do mesmo slot/operação. Valores positivos consecutivos iguais geram `CONSECUTIVE_EQUAL_EARNINGS` e não são gravados. A mensagem de erro foi adicionada aos fluxos Pro e Print. A proteção existente de limite de operação, slot já utilizado, hash duplicado de comprovante e anúncio/valor dobrado foi preservada.

## Causa do ganho persistido como R$ 0,00

No chunk `RecordTrip`, o alias importado como `fa` apontava para o export `am` do bundle principal. Esse export é o resolvedor de empresa (`empresaId/companyId`), não uma função monetária. O código chamava `fa(w)` ao montar `tripData`, embora `w` fosse o texto do ganho OCR, por exemplo `16.166,00`. O campo visual recebia corretamente o OCR por estado React, mas a persistência recebia `null`/zero.

A correção substitui essa chamada por `Qc(w)`, parser local determinístico que remove símbolo monetário, converte separadores brasileiros e grava o valor numérico com duas casas decimais. O caso `16.166,00` agora resulta em `16166.00` no payload.

## Validações executadas

Os chunks JavaScript alterados passaram em `node --check`. O `versionCode` foi atualizado para `379` e o build release foi iniciado com Android SDK 36 e JDK 21. A assinatura original do projeto não estava presente no pacote; o APK final deverá ser assinado com uma keystore release criada para este artefato ou com a keystore original fornecida pelo responsável pelo aplicativo.
