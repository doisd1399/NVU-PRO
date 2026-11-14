# NVU — entrega do assistente de voz

Fonte atualizada: **1.0.596** · Web: **2.3.253**. Base: arquivo 1.0.595 enviado pelo usuário.

## O que foi incluído

- Duas vozes GPS aprovadas, masculina e feminina, com o ritmo escolhido.
- 54 áudios curtos: cinco saudações de motorista e cinco de administrador em cada voz, além de áreas e confirmações.
- Controles nos menus flutuante e lateral: ativar/silenciar, voz, volume, Completo/Discreto e Ouvir exemplo.
- Rodízio persistente, limites de frequência e canal único entre a WebView e o PRO Android. A troca de voz não corta a fala em andamento.
- Confirmações observam respostas reais do servidor; a hidratação e os registros antigos ficam em silêncio.
- Arquivos de reprodução incluídos no projeto e no dist, sem síntese remota durante o uso.

## Resultado da validação

| Verificação | Resultado |
| --- | --- |
| Tipos e build Web | Passaram |
| Controlador de voz | 23 casos passaram |
| Canal nativo Java com portas Android controladas | 19 verificações passaram |
| Ponte React de confirmações | 6 cenários passaram |
| Controles reais dos dois menus em React DOM | Passaram |
| MP3 e preservação das amostras aprovadas | 54 arquivos conferidos, amostras idênticas |
| Transcrição local de conferência do texto | 54 arquivos, sem sinalização pendente |
| Dist e assets Android | 54 áudios presentes; espelho verificado |
| Bateria geral `npm run qa` | BLOCKED: 27 etapas passaram, 9 falharam, 1 bloqueada |

O relatório geral original está em `qa/results/latest.html`. Oito etapas falharam ao iniciar o Chromium por restrição de sockets do ambiente; a etapa visual de voz registrou BLOCKED pela mesma limitação. A comparação temporal de desempenho falhou na primeira execução e os nove casos passaram na repetição, registrada em `qa/results/voice-delivery/contracts-recheck.log`. O relatório geral não foi editado para declarar aprovação.

No Firebase local, 13 etapas passaram, incluindo segurança, ciclo operacional, parcerias, recompensas, armazenamento, push e metas/ranking. A continuação visual parou em print-ui, que não iniciou o navegador; app-shell não chegou a executar. Somente o projeto demo foi utilizado.

A avaliação React DOM não comprova o layout em pixels. A avaliação Java controla as portas Android e não substitui um aparelho. Android instrumental, OAuth real, GTO/ETS2/ATS e APK não foram validados nesta entrega. Não houve publicação.

## Arquivos e uso

- `public/audio/nvu/`: MP3, catálogo e manifesto de integridade.
- `docs/ASSISTENTE-DE-VOZ-596.md`: regras, gatilhos conectados e limites.
- `dist/`: build Web que acompanha esta entrega.
- `android/app/src/main/assets/public/`: fallback WebView sincronizado.
- `qa/results/`: resultados e logs da fonte atual.

Para desenvolvimento: `npm ci` e `npm --prefix functions ci`. Build: `npm run build`. Após novas alterações Web: `npx cap sync android`, `npm run prepare:cap-assets` e `npm run verify:cap-assets`. Para os testes Java, usar JDK 21 completo.

Para gerar um APK, ainda é necessário o fluxo próprio `qa:release`, `qa:gate`, compilação e assinatura no ambiente Android. Uma troca somente de dist não adiciona o plugin nativo ao APK já instalado.
