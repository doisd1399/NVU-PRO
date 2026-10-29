# Auditoria ponta a ponta — Modo Print / OCR de ganhos — R5

Data: 2026-09-21

## Sintoma observado

Ao abrir `/driver/trip?mode=print`, o Android apresentava a tela global `Não foi possível abrir este conteúdo / falha inesperada de renderização`.

## Causa técnica encontrada

A rota de Print compartilhava o mesmo ciclo de renderização da tela operacional antes de chegar ao branch que deveria abrir o Modo Print. Havia várias operações que pressupunham dados já hidratados (`find`, `filter`, `some`, `roles.includes`, cálculo de progresso) enquanto a rota Print pode ser aberta imediatamente, inclusive durante a hidratação assíncrona. Uma exceção nesse período sobe para o Error Boundary global e transforma a abertura do Print em uma falha de renderização.

O ponto mais importante foi a necessidade de tratar a rota Print como uma rota que precisa ser **render-safe durante carregamento**, sem depender da existência imediata de jobs, contratos, veículos, reboques, memberships ou trips.

## Correções aplicadas

1. Coleções operacionais agora são normalizadas para arrays antes de `find/filter/some`.
2. `membership.roles` somente é consultado com `Array.isArray`.
3. O cálculo de progresso usa `[]` como fallback quando a lista de viagens ainda não estiver disponível.
4. Veículo e reboque usam fallback seguro durante hidratação.
5. A verificação de disponibilidade do Modo Print passou a ser protegida por `try/catch`; uma falha transitória de disponibilidade não pode derrubar a renderização da rota.
6. O comportamento existente de manutenção continua sendo respeitado quando a disponibilidade é confirmadamente desabilitada.
7. O bundle foi validado com `node --check`.
8. `nvu-build.json` foi atualizado para identificar o bundle como R5, evitando tratar o artefato corrigido como se fosse o R4.

## Fluxo esperado após a correção

`Perfil motorista → Modo Print → /driver/trip?mode=print`

A tela deve permanecer renderizável mesmo se dados operacionais ainda estiverem carregando. O OCR somente começa depois que o usuário seleciona o comprovante; a abertura da tela não deve aguardar OCR, jobs, histórico ou consultas de viagens.

## Integridade da leitura de ganhos

A correção não remove as proteções já existentes contra valor dobrado/anúncio. O valor monetário continua sendo promovido somente após a decisão final do OCR, evitando que um valor intermediário seja persistido como definitivo.

Exemplos de regressão já presentes no projeto:

- `R$ 16.166,00` → `1.616.600` centavos
- `R$ 1.234,56` → `123.456` centavos
- `R$ 99,90` → `9.990` centavos

## Limite desta entrega

O APK Release assinado não foi recriado neste ambiente porque a keystore/certificado original de Release não está presente no projeto. Não é seguro gerar uma nova chave, pois ela não seria compatível com uma instalação/publicação existente assinada pelo certificado original.

## Próxima validação obrigatória no dispositivo

1. Abrir o APK com sessão já autenticada.
2. Entrar em Trabalho GTO.
3. Tocar em Modo Print repetidamente durante carregamento e após hidratação.
4. Confirmar que a tela abre sem spinner bloqueante nem Error Boundary.
5. Selecionar prints reais com valores pequenos, médios e acima de R$ 10.000.
6. Confirmar que o valor exibido no campo de ganho é exatamente o valor textual do print.
7. Confirmar que um print com anúncio/valor dobrado não é aceito.
8. Confirmar envio idempotente e ausência de duplicidade.
