# NVU — assistente de voz

Atualização sobre o projeto enviado 1.0.595. Fonte candidata Android 1.0.596 / Web 2.3.253, de 13/11/2026.

## Controles

No menu flutuante e no menu lateral, abra **Assistente de voz**. Há opções para ativar/silenciar, escolher **Masculina** ou **Feminina**, regular volume, escolher **Completo** ou **Discreto** e ouvir um exemplo. As preferências ficam salvas por conta neste dispositivo.

Completo oferece saudações, algumas áreas e confirmações importantes. Discreto mantém saudações e confirmações. A seleção da próxima voz não interrompe a frase atual. Silenciar é uma ação explícita e para o som.

## Áudios aprovados

- Feminina: pt-BR-FranciscaNeural, ritmo ajustado em 1,12×.
- Masculina: pt-BR-AntonioNeural, ritmo ajustado em 1,24×.
- Os dois exemplos aprovados da central foram preservados sem alteração de bytes.
- 27 frases em cada voz: 54 MP3 locais, cinco saudações por papel em cada voz.
- Voz limpa, sem música, eco ou efeito robótico. Reprodução usa os arquivos locais; não chama síntese de voz, API paga ou Functions.

O catálogo com todos os textos fica em `public/audio/nvu/catalog.json`. O manifesto registra duração, tamanho e SHA-256 de cada arquivo em `public/audio/nvu/manifest.json`. Os nomes identificam os provedores usados na produção das amostras; esta entrega não representa cessão de direitos sobre vozes de terceiros.

## Gatilhos conectados

| Situação | Regra |
| --- | --- |
| Entrada do motorista | Uma das cinco saudações do motorista |
| Entrada do administrador | Uma das cinco saudações da central |
| Áreas da gestão | Operações, Designar trabalhos, Trabalhos ativos, Equipe, RH, Frota, Viagens, Parcerias e Carteira, conforme a rota/aba real |
| Novo trabalho | Notificação nova após hidratação, dirigida ao motorista e à empresa ativa |
| Início do trabalho | Transição observada para CONFIRMED, com retorno do trabalho ativo no outbox operacional |
| Finalização da operação | CONFIRMED com completed=true e trabalho completed |
| Viagem registrada | Evento canônico novo SERVER_CONFIRMED/HISTORY_CONFIRMED, da conta e empresa ativas |
| Modo PRO no Android | Os pontos nativos existentes de início, detecção do término e pedido de pausa passam pelo mesmo canal e pela voz escolhida |

O áudio de detecção informa **“Viagem concluída. Preparando o registro.”**; somente a confirmação do servidor informa que a viagem foi registrada. O catálogo também inclui uma fala de falha para integração futura; uma tentativa offline/pendente não é tratada como falha definitiva e esse áudio não foi conectado a erros genéricos.

## Regras de silêncio

- Uma saudação por papel a cada sessão. Nova sessão após 30 minutos sem atividade. Reabertura rápida e recarga não repetem a saudação.
- Rodízio persistente das cinco saudações, sem repetir a anterior no início da próxima rodada.
- Espera de 900 ms na área. Navegação rápida cancela a intenção anterior.
- No máximo uma fala por área/sessão, uma fala de navegação por minuto e três a cada dez minutos.
- Intervalo mínimo de oito segundos entre falas automáticas. O exemplo manual pode ser ouvido sem esperar esse intervalo, se o canal estiver livre.
- Um áudio ativo e, no máximo, uma confirmação aguardando. Aviso novo pode substituir apenas o que aguarda, conforme prioridade. Nenhum aviso automático interrompe a frase atual.
- Intenções antigas expiram; navegação em fila é descartada. Troca de conta, empresa, simulador e rota invalida o que ficou desatualizado.
- Fundo da WebView cancela sua fala e sua fila; a voz do serviço PRO Android continua sob controle do serviço. Sair da conta e silenciar cancelam explicitamente o áudio.
- Bloqueio de autoplay no navegador aguarda um gesto. Falha de áudio não bloqueia telas, filas de viagens ou comandos.

## Integração e verificação

`voiceAssistantCore.ts` controla sessões e fila. `VoiceAssistantBridge.tsx` observa eventos confirmados. `VoiceAssistantSettings.tsx` é compartilhado pelos menus. No Android, `NvuVoicePlayback` coordena WebView e os serviços existentes, com reprodução local e volume próprio.

Executar `npm ci` e `npm --prefix functions ci`; usar JDK 21 completo para os testes Java. `npm run qa` inclui testes de controlador, catálogo, controles React, ponte de confirmações, canal Java e tentativa visual em Chromium. O resultado da execução está em `qa/results/latest.html` e nos relatórios de voz. A checagem de transcrição local avalia integridade do texto, sem substituir avaliação auditiva.

Esta entrega contém código e dist. Um novo APK precisa incorporar o plugin e os assets, passar `qa:release` e `qa:gate` e ser assinado no ambiente de release. A validação em aparelho Android e nos simuladores depende desses ambientes. Não há publicação nem liberação de APK implícita nesta atualização.
