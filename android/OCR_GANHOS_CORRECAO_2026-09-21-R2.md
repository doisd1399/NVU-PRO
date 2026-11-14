# Correção OCR de ganhos — R2 — 2026-09-21

## Causa raiz corrigida

A leitura OCR podia gerar duas interpretações diferentes para a mesma região do comprovante: a passagem pré-processada/threshold e a passagem sobre a imagem original. O pipeline anterior podia manter a leitura da imagem threshold como candidata contextual mesmo quando a passagem sobre a imagem original encontrava o valor correto como candidato genérico. Como o consenso posterior tratava essas listas separadamente, o valor correto podia ser descartado e o resultado final permanecer `null`, deixando o campo de ganhos em `0,00`.

## Correção aplicada

Arquivo alterado:

`android/app/src/main/assets/public/assets/RecordTrip-DOvgqCMk.js`

1. Na passagem OCR sobre a imagem original, quando o texto contém contexto de `Valor a receber`/`receber` e existe um candidato monetário genérico válido, esse candidato passa a ser promovido para a decisão da própria região quando a extração contextual direta não o reconhece.
2. A leitura da imagem original passa a ter precedência sobre a leitura threshold da mesma região, evitando que uma distorção introduzida pelo pré-processamento substitua uma leitura válida do original.
3. O consenso genérico deixa de retornar `null` apenas por uma ordem parcial sem maioria: somente promove uma leitura genérica quando existe maioria clara e mínima de duas ocorrências.
4. Não foi alterada a proteção contra valores duplicados por anúncio/recompensa.
5. Não foi alterado o fluxo nativo do Capacitor; a correção está limitada ao bundle web embarcado no Android.

## Validação técnica

- Sintaxe JavaScript validada com `node --check`.
- Nenhum outro arquivo de runtime foi alterado além do bundle OCR.
- O projeto continua usando o mesmo build Android/base fornecido anteriormente.

## Regressões-alvo

- `R$ 16.166,00` com threshold incorreto e OCR da imagem original correto → deve preencher `16.166,00`.
- `R$ 1.234,56` → deve preencher `1.234,56`.
- `R$ 10.000,00` → deve preencher `10.000,00`.
- `R$ 99,90` → deve preencher `99,90`.
- Conflito real entre regiões independentes sem maioria → deve permanecer ambíguo, sem preenchimento automático.
- Detecção de valor dobrado por anúncio → continua bloqueando o preenchimento automático.
