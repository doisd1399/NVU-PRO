# Auditoria ponta a ponta — fluxos Print e Pro

## Escopo

O modo Print é o lançamento manual baseado em comprovante enviado pelo motorista. O modo Pro é o fluxo automatizado: o aplicativo captura a tela final do simulador, valida o contexto da operação, extrai o ganho e grava a viagem. A auditoria comparou leitura, validação, bloqueios, escrita do histórico, progresso da operação, encerramento e projeções locais.

## Arquitetura compartilhada confirmada

Os dois fluxos agora convergem para `operationalCompletionCoordinator`. O coordenador recebe o payload normalizado, chama `TripsRepository.addTripWithinOperationLimit`, preenche `tripId`, `completedAt`, `updatedAt` e `dataLancamento`, projeta o registro nos caches de histórico e reconcilia o progresso do trabalho. A gravação transacional reserva o slot `jobId + sequência`, valida o status da operação, rejeita limite excedido e rejeita ganhos positivos idênticos consecutivos.

O Print usa OCR ou preenchimento manual, mas a escrita final é a mesma do Pro. O Pro acrescenta pré-validação de contexto da captura, bônus/anúncio e duplicidade da captura; isso é uma camada anterior e não substitui a transação compartilhada. O histórico remoto é lido por assinatura de empresa e por assinatura de motorista, enquanto o cache local nativo do Pro é reconciliado posteriormente contra o Firestore.

## Divergências críticas encontradas

A primeira divergência era de representação monetária. O Print persistia apenas `valor`, enquanto o Pro persistia `valorCents`. O guard transacional podia converter corretamente a maioria dos formatos, mas ficava sujeito a ambiguidade quando o valor manual usava ponto como separador de milhar sem vírgula. O Print passou a enviar `valorCents` explicitamente, e a comparação de ganhos do repositório passou a priorizar centavos quando o campo estiver presente.

A segunda divergência era de pós-commit. O Pro grava remotamente pelo coordenador e depois chama `SimpleAutomation.recordConfirmedTrip` para projetar o item no histórico local nativo. Se essa projeção local falhasse, a exceção podia fazer o usuário enxergar falha depois de a gravação remota já ter sido concluída, incentivando nova tentativa e criando risco de inconsistência visual. A projeção agora é fail-open: uma falha local é registrada e o Firestore permanece a fonte autoritativa para reconciliação, sem desfazer nem repetir a gravação.

A terceira divergência era de feedback. O evento de card foi removido do fluxo Print. O listener também exige `mode: "pro"`, de modo que uma emissão indevida não consegue mostrar o card manualmente. A leitura e o registro Print continuam funcionando sem áudio e sem card.

## Verificações de ponta a ponta

| Etapa | Print manual | Pro automatizado | Resultado |
|---|---|---|---|
| Identidade da operação | `jobId`, contrato, empresa e motorista ativos | Contexto da captura comparado com empresa, job, contrato, simulador e sessão | Consistente |
| Leitura do ganho | OCR/entrada manual normalizados | OCR nativo com campo de resultado e bloqueio de bônus/anúncio | Consistente após centavos explícitos |
| Validação | Origem, destino, valor, distância quando aplicável, hash e duplicidade de imagem | Captura pronta, contexto, origem/destino, ganho positivo, bônus e duplicidade Pro | Camadas específicas preservadas |
| Escrita | Coordenador compartilhado | Coordenador compartilhado | Mesma transação de slot |
| Ganho persistido | `valor` e `valorCents` | `valor` e `valorCents` | Unificado |
| Limite e sequência | Guard transacional | Pré-guard + guard transacional | Fonte final única no repositório |
| Histórico remoto | Listener de empresa e cache otimista | Listener de empresa/motorista + projeção nativa reconciliável | Firestore autoritativo |
| Progresso da operação | `syncJobProgress` após commit | `syncJobProgress`, fechamento e refresh de snapshot | Consistente |
| Feedback de finalização | Nenhum card e nenhum áudio | Card Pro; áudio nativo original somente no Pro | Conforme regra do produto |

## Correções aplicadas

Foram alterados os chunks `RecordTrip`, `DriverLayout` e `TripsRepository`. O Print agora inclui `valorCents: Math.round(valor * 100)` no payload final. O repositório compara centavos explícitos antes de converter texto. O pós-commit Pro não transforma falha de projeção local em falha de registro remoto. O evento de finalização Print foi removido e o componente de feedback aceita apenas modo Pro.

A versão nativa foi incrementada para `1.0.380` / `versionCode 380`, usando a keystore original recuperada do Drive e o `google-services.json` original. O áudio nativo `nvu_trip_completed_voice_pt_br.mp3` permanece no recurso Android e continua sendo disparado por `NvuAudioManager` apenas no caminho Pro elegível.

## Testes executados

Os três chunks alterados passaram em `node --check`. Foram verificadas a presença do parser monetário, do campo `valorCents`, do guard `CONSECUTIVE_EQUAL_EARNINGS`, do evento Pro e a ausência do evento Print. O build Release foi executado com sucesso, o APK foi assinado pela keystore original e a assinatura V2 foi validada com `apksigner`. A integridade do pacote do projeto foi validada com `unzip -t`.

## Limites da auditoria

A auditoria estática não substitui um teste real com uma conta Firebase em dispositivo físico. Para homologação, recomenda-se executar uma sequência Print com ganhos `16.166,00`, `22.737,00`, repetir o mesmo ganho consecutivamente e testar o encerramento da última viagem; repetir a mesma sequência no Pro; fechar e reabrir o histórico; e confirmar que cada sequência produz exatamente um documento por slot e que o progresso do trabalho coincide com a quantidade de documentos válidos.
