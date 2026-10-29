# OCR GANHOS — Correção R3 — 2026-09-21

## Problema identificado
A correção R2 ainda podia deixar a leitura automática sem valor porque o consenso final continuava dependente de uma votação global que misturava regiões e passes OCR. Além disso, uma única região contextual válida podia ser descartada quando outra região produzia uma leitura conflitante.

## Correção R3
- Cada crop OCR é tratado como uma fonte independente.
- Dentro de cada crop, a leitura contextual da imagem original (`raw-image`) tem prioridade sobre a leitura threshold.
- Duas passagens da mesma região não contam como dois votos independentes.
- O consenso é feito entre crops distintos.
- Uma única leitura contextual de um único crop é aceita somente quando não existe outra leitura contextual independente conflitante.
- Leituras genéricas continuam sujeitas a confirmação por repetição; não são promovidas isoladamente.
- A proteção de anúncio/valor dobrado permanece ativa.
- O callback `onValueDetected` somente é chamado depois da decisão final do valor.

## Caso de regressão
A imagem de teste contém `Valor a receber R$ 16.166,00`. O OCR threshold pode gerar uma leitura degradada, enquanto a passagem da imagem original reconhece `16.166,00`. A passagem original deve prevalecer e o valor deve chegar ao campo `Valor ganho (R$)`.
