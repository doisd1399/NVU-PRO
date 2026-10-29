# Retomada após reinício do ambiente

Em 26/10/2026 o envio de uma revisão corretiva maior foi interrompido antes de confirmação. A branch permaneceu em `cac1388ae5fbe6bf4f5663f210a63aca738debee`; o checkout temporário `nvu-ci` e os resultados dessa revisão não reapareceram no ambiente restaurado. O commit local curto cdbf0db não estava no GitHub. Não se presume que o envio tenha concluído.

A base foi recuperada do repositório e conferida: 1.646 blobs; árvore exata `769f12333c89f1f86ccd50f9f4b7fa2f41663853`. Os 15 grupos relatados antes da interrupção pertencem à cópia temporária anterior e não aprovam esta reconstrução. Seus JSON/logs não foram inventados.

Primeiro lote reconstruído: PUSH-01. O cliente libera a promessa de registro ao terminar, verifica novamente a permissão sem repetir prompts de uma negativa, aguarda a instalação dos listeners e compartilha as chamadas concorrentes. Repetições idênticas não regravam a associação no servidor. Falhas recebem no máximo três retries automáticos; foreground/online permitem nova recuperação. Há limite para aguardar token nativo. Logs não expõem tokens ou payloads de notificações.

O teste novo usa o serviço real com Capacitor/callable controlados e passou em sete cenários. Não comprova entrega FCM no Android real. O catálogo de QA inclui esse teste em quick/Web/release. Após o primeiro lote os demais oito P1 originais ficaram abertos até reconstrução e nova validação; não são declarados corrigidos por causa da execução perdida. A liberação de APK continua bloqueada. Nenhum backend, regra, índice ou dado de produção foi alterado.

Resultados da fonte atual: `qa/results/latest.json` na execução local e artefatos do workflow na branch. A recuperação será publicada em lotes menores, com confirmação do commit remoto antes de avançar, para evitar outro lote extenso sem persistência.

## Segundo lote: servidor push

PUSH-02 e PUSH-03 foram reconstruídos e testados em 11 cenários com o backend compilado e transações reais do Firestore local. Falha individual transitória mantém o despacho repetível, preservando sucessos por destinatário. O processamento tem lease de 90 segundos, backoff e expiração de eventos antigos; ambos os gatilhos mantêm seus nomes e ativam retry. Limpeza de duplicatas inválidas é limitada para respeitar o limite de escritas da transação.

O registro/revogação canônicos têm revisão monotônica e fence por hash de token. Uma requisição atrasada do dono anterior não apaga o novo dono. Há suporte à limpeza de registros antigos sem fence. A conexão desses endpoints ao logout do cliente será tratada no próximo lote: PUSH-04 permanece aberto. SEC-01/02/03/04 e DEP-01 também continuam abertos. Não houve envio FCM real nem publicação em Firebase.

A fonte do primeiro lote passou em 14 grupos Web/Firebase na execução 2026-10-26T23-24-18-286Z, com fingerprint conferido. Esse resultado precede o segundo lote; a bateria da fonte completa atual roda novamente localmente e no workflow da branch.

## Terceiro lote: logout e troca de conta

PUSH-04 foi conectado ao cliente com revisão monotônica persistida, metadados por UID/hash e fila de revogações sem tokens brutos. O logout inicia a limpeza antes da revogação do Auth; a espera tem limite de 2,5 segundos, para não prender a interface em uma rede indisponível. Também solicita exclusão do token nativo e das notificações entregues. Resposta atrasada da conta antiga não apaga os metadados da nova conta.

Falha offline mantém a revogação para nova tentativa na sessão correta. Essa limpeza não bloqueia o registro de um token novo; o servidor compara as revisões. Os testes atuais do cliente passaram em nove cenários, incluindo ACK atrasado durante troca de conta e recuperação da revogação offline. Isso não promete recolher mensagens já em trânsito, nem comprova exclusão nativa em Motorola; o transporte nativo continua controlado no teste.

A fonte do segundo lote passou novamente em 14 grupos na execução 2026-10-26T23-31-54-681Z. O recibo está em verification/audit-2026-10-26/recovery/server-qa.json. Os quatro achados de regras e DEP-01 seguem abertos. Produção permanece inalterada; a liberação de APK continua bloqueada.
