# NVU — Auditoria R6 — Modo Print

## Evidência
A captura apresentada em 21/09/2026 mostra o Error Boundary global: “Não foi possível abrir este conteúdo / falha inesperada de renderização”. O problema ocorre na abertura da rota `/driver/trip?mode=print`, antes da seleção do comprovante.

## Causa arquitetural identificada
O R5 ainda carregava o componente operacional completo `RecordTrip` para a rota Print. Mesmo com guards de dados, a rota executava hooks, hidratação de operação, histórico, disponibilidade e cálculos da tela normal antes de chegar ao bloco específico do Print. Isso mantém o Modo Print acoplado ao restante da página e permite que uma exceção em qualquer parte da árvore derrube a renderização inteira.

## Correção R6
- Isolado o bootstrap da rota Print: `mode=print` agora monta um componente próprio `NvuPrintMode`.
- A tela Print não depende mais da renderização da tela operacional completa.
- Abertura da interface é síncrona; carregamento do histórico não bloqueia o primeiro paint.
- Upload e OCR são iniciados somente após o usuário selecionar o comprovante.
- OCR e cálculo do hash local são executados em paralelo.
- Mantidos: validação de anúncio/valor dobrado, verificação de imagem duplicada, upload Firebase, estado autoritativo da operação e gravação transacional da viagem.
- O valor identificado pelo OCR permanece como fonte do campo de ganho no Modo Print.
- O hash real da imagem é persistido no lançamento.
- A rota normal `/driver/trip` continua usando o componente operacional legado para não misturar os dois fluxos.

## Validação estática
- `node --check RecordTrip-DOvgqCMk.js`: PASS
- Bundle mantém Tesseract, parser monetário e repositório de viagens.
- `versionCode`: 377

## Limitação de build
A assinatura Release original não está presente no projeto/ambiente e o Gradle wrapper não está disponível localmente para compilação offline. Portanto, este R6 é o projeto Android corrigido e atualizado; um APK Release assinado com o certificado original ainda requer a keystore de Release original.
