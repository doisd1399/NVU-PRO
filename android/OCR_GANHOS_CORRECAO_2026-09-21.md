# NVU Android — Correção OCR de ganhos

Data: 2026-09-21

## Escopo

Somente o projeto Android foi atualizado. Nenhum arquivo `src/` ou projeto Web separado foi incluído neste pacote.

## Correções incorporadas no bundle Web embarcado no Android

Arquivo:
`app/src/main/assets/public/assets/RecordTrip-DOvgqCMk.js`

1. A crop dedicada da linha de valor usa canvas 2200x300 com `imageSmoothingEnabled=false`, preservando os pixels pequenos do valor monetário.
2. A seleção do valor dedicado não promove mais automaticamente uma leitura isolada pela maior confiança quando existem leituras conflitantes.
3. Quando há consenso de pelo menos duas leituras, o valor consensual é utilizado.
4. Uma única leitura só é aceita quando ela é a única candidata disponível.

## Objetivo

Evitar que `R$ 16.166,00` seja transformado em uma leitura incorreta como `R$ 18.166,00` por distorção de glyph 6/8 causada pelo redimensionamento/interpolação da crop.

## Validação local

- Bundle Android contém `imageSmoothingEnabled=!1` na função de crop monetária dedicada.
- Bundle Android não contém mais o fallback antigo que escolhia a leitura conflitante pela maior `confidence`.
- Este pacote não declara um APK Release novo compilado; a correção está aplicada diretamente aos assets Web já embarcados no projeto Android.
