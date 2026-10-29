# NVU PRO 1.0.520 — envio e imagens offline

Android 1.0.520 (code 520), Web 2.3.197. Base: fonte e APK 1.0.519 entregues nesta conversa.

## Envio de viagens

- O arquivo original é copiado e salvo no IndexedDB, com o hash e o proprietário, antes da rede. O upload começa antes do OCR. OCR e validação de anúncio continuam usando o original, e a viagem só pode ser lançada depois da análise válida.
- Uma cópia WebP de transporte usa qualidade 0,92 e dimensão máxima de 1920 px. Imagens menores que 280 kB não são recomprimidas; a troca só é usada quando economiza pelo menos 15%. O original não é alterado. Se o preparo falha ou passa de 1,5 s, o envio mantém o arquivo original e os limites anteriores.
- Comprovantes pequenos usam `uploadBytes`, eliminando a negociação de sessão recuperável. O comprovante local e a mesma tentativa canônica continuam sustentando novas tentativas. A URL é confirmada antes de registrar a viagem.
- O servidor paraleliza o preflight e compartilha as leituras de usuário/empresa com a autorização dentro da mesma transação. Revogação, suspensão, limites, slots, comprovante e idempotência continuam verificados.
- Recuperações antigas de autorização e finalizações de outras operações não seguram um novo comando canônico. A barreira de início da operação, a ordem por operação e a troca de conta continuam sendo respeitadas.
- A Function registra apenas tempos de etapas em `NVU_TRIP_TIMING_520`, sem imagem, token, nome ou conteúdo do comprovante. O painel de diagnóstico continua aparecendo apenas após uma falha real.

## Fotos, capas e logos

As 29 superfícies que utilizavam `img` diretamente agora passam por `CachedImage`, mantendo o mesmo elemento e layout. Isso inclui `StableImage`, perfis, Equipes, histórico, cadastros, moderação e prévias. Os bytes ficam em um IndexedDB separado do diário de viagens, identificados por conta e URL completa. A navegação reutiliza URLs locais em memória; a reabertura hidrata o cache persistente sem precisar do cache HTTP.

Fotos de identidade e capas do usuário e da empresa ativa são preparadas durante o uso do workspace, antes de abrir o histórico. O preloader de imagens também reutiliza os bytes locais. A mudança de conta isola o cache; uma URL nova seleciona a imagem nova e a remoção explícita não ressuscita uma foto antiga.

O cache é limitado a 192 arquivos/64 MiB, com descarte das entradas menos recentes. Imagens inéditas precisam da primeira conexão; as já armazenadas podem ser exibidas offline. As capas editadas e os comprovantes pendentes continuam nos seus armazenamentos próprios, fora da política de descarte desse cache.

## Publicação

`registerCanonicalSimpleTrip` foi atualizada em produção no projeto `vtc-frota-log`. Nenhuma regra, índice ou configuração de instâncias mínimas foi alterada. A verificação sem autenticação continua retornando 401. Detalhes em `reports/release-520/`.

O ZIP separado da Dist tem `index.html`, `assets`, `_redirects` e `_headers` diretamente na raiz e está pronto para o Netlify. O APK contém exatamente o mesmo build Web. OTA continua desativada.

## Validação

- 9 cenários de upload/ACK/autorização e identidade, usando adaptador real e fixtures transacionais.
- 31 cenários da fila e recuperação, incluindo rejeições, timeout, ACK perdido e preservação do comprovante.
- 2 cenários do supervisor, incluindo envio novo durante finalização lenta e bloqueio no logout.
- 8 cenários no Chromium: persistência real de imagens, navegação sem nova rede, reabertura com imagens remotas bloqueadas, troca de conta, alteração/remoção, capa no primeiro render após hidratação e redução de transporte.
- 16 cenários de capa, 13 de vínculos, 4 de Equipes e 5 de visibilidade do diagnóstico, além dos testes de diagnóstico e tombstones existentes.
- Build Web, Functions, paridade fonte/Dist/assets/APK, certificado original, alinhamento, assinatura v2/v3 e 35 testes nativos.

O ensaio de compressão usa uma imagem sintética de 1920×1080 e não constitui medição no Motorola. Não se promete um tempo de 3 segundos: o teste manual do usuário em produção é a próxima medição de latência.

## Recompilar

Use Node 22+, JDK 21, Android SDK 36 e Build Tools 35.0.0. Instale com `npm ci` e `npm --prefix functions ci`. Restaure o `android/app/google-services.json` de produção e configure as variáveis de assinatura fora do projeto. Execute `bash scripts/android-release-520.sh`. Nenhuma senha, chave privada, token de CLI ou keystore está incluído.

O teste 518 e os verificadores 516/518 são históricos; utilize o script 520 e os relatórios desta versão. Para testar no aparelho, instale como atualização, sem desinstalar nem limpar os dados. Use um print novo, pois a proteção contra reutilização de viagens excluídas permanece ativa.
