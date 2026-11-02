# NVU PRO Windows — candidata 0.1.4

A 0.1.4 usa o mouse para todas as ações e Ctrl+N somente para abrir/ocultar. O card mantém a viagem atual fora da rolagem e permite alternar o tema. A janela interativa cobre a área útil do monitor enquanto aberta para manter o cursor sob controle da NVU; avisos separados no topo central ignoram cliques e não tomam foco. O jogo pode pausar ao perder foco para o assistente; o retorno ao jogo usa Win32 com orientação Alt+Tab se o Windows negar.

Esta edição acrescenta Electron e o plugin nativo SCS ao mesmo projeto Web/Android. O instalador é candidato a validação: executar testes controlados e compilar não comprova comportamento com Windows, Google e jogos reais.

## Preparação e execução

Requisitos: Windows x64, Node 24, Visual Studio 2022/Build Tools com C++ e SDK Windows, CMake 3.20+, Steam e ETS2/ATS x64. Para a bateria geral, JDK 21 e os demais requisitos de `qa/README.md`.

Na raiz:

```powershell
npm ci
npm --prefix functions ci
npm run windows:setup
npm run windows:plugin
npm run test:windows
npm run qa
npm run windows:dev
```

Gerar o instalador após o build do plugin:

```powershell
npm run windows:installer
```

Gere a versão sem instalação em ZIP:

```powershell
npm run windows:portable
```

É gerado `NVU-PRO-Windows-0.1.4-x64-Portable.zip`, com a aplicação completa para extrair e abrir `NVU PRO.exe`. Quando o instalador já foi compilado, o comando também gera `NVU-PRO-Windows-0.1.4-Instalador.zip`, com o instalador como `NVU-Setup.exe`, instruções e SHA-256. Extraia todo o conteúdo antes de executar; preserve a pasta `resources` junto do aplicativo. A versão sem instalação usa os mesmos dados em `%APPDATA%\NVU PRO`.

### Empacotamento ZIP e diagnóstico NSIS da 0.1.4

Foi observado no ambiente de compilação um ZIP temporário íntegro que ficou truncado ao renomeá-lo para o caminho final. A publicação agora copia por stream com flush, compara tamanho/SHA-256 e repete o teste 7-Zip no arquivo final antes de emitir checksum. Arquivos truncados ou alterados não são publicados.

O erro NSIS relatado no PC do usuário continua separado desse achado: a cópia do instalador 0.1.4 recuperada dos arquivos disponibilizados tem 129507585 bytes, SHA-256 `dbe7ff3ebe114a29c7a39339c6065a9cbf2a286cf28607f48e5fd2f997bdda6d` e CRC nativo `302ac727`, iguais ao original. Sem o arquivo efetivamente executado ou seu tamanho/hash, a causa no PC permanece indeterminada. O Portable 0.1.4 permite abrir a mesma aplicação extraindo TODO o ZIP e executando `NVU PRO.exe`, sem passar pelo instalador NSIS. Nenhuma proteção ou verificação de integridade é desativada.

### Falha de integridade NSIS da versão 0.1.1 (histórico)

A imagem enviada pelo usuário mostra uma falha de integridade, mas não contém o tamanho nem o hash do EXE que falhou. A cópia gerada e a cópia recuperada do arquivo disponibilizado têm 125712878 bytes, SHA-256 `2e1b315677f726222ec8a8d2fdd4b5b40deb92b52b62081a038951b3458994a3` e CRC interno NSIS `8717188d`, todos conferidos. A causa no PC ainda exige comparar o arquivo efetivamente baixado. A alternativa sem instalação permite validar a aplicação independentemente do NSIS.

O build agora valida o cabeçalho, o comprimento e o CRC nativo NSIS antes de publicar um checksum. Testes com um instalador NSIS real compilado rejeitam alterações no stub, no conteúdo e no CRC, truncamento, bytes extras e CRC desligado. Essa validação é adicional ao teste de extração do arquivo. O verificador cobre instaladores NSIS 3 sem assinatura; a futura assinatura exige ampliar a validação do layout do certificado.

O pacote será escrito em `artifacts/windows`. O empacotamento usa electron-builder para a aplicação e NSIS 3.12 (bundle 1.2.1 verificado por SHA-256) para instalação/desinstalação por usuário. O script não executa arquivos Windows durante a compilação e também funciona em um host Linux, sem Wine. A desinstalação remove somente os arquivos listados na entrega, preservando dados e plugins. A DLL compilada acompanha o código em `desktop/windows/plugin/bin/nvu_scs_telemetry.dll`. O build CMake com MSVC pode gerar bytes diferentes da compilação MinGW incluída. Mantenha o executável e a DLL da mesma entrega.

## Configurações externas necessárias

1. A candidata 0.1.4 mantém o cliente OAuth **Desktop** NVU PRO Windows fornecido pelo proprietário, do projeto `vtc-frota-log`. O JSON foi conferido como tipo `installed`, com os endpoints oficiais do Google e o número do projeto Firebase da NVU. O login real com a identidade Firebase original continua exigindo validação no Windows.
2. A configuração usada no empacotamento fica em `desktop/windows/config/google-oauth.json`, nos campos `clientId` e `clientSecret`. Para substituir o cliente, esses valores correspondem a `installed.client_id` e `installed.client_secret` no JSON baixado do Google. O administrador também pode fornecer `%APPDATA%\NVU PRO\google-oauth.json`, ou as variáveis `NVU_GOOGLE_DESKTOP_CLIENT_ID` e `NVU_GOOGLE_DESKTOP_CLIENT_SECRET`, que têm prioridade sobre o arquivo empacotado. Confira configurações locais antigas ao atualizar. O cliente Desktop é público e usa PKCE; tokens de usuário não fazem parte da configuração distribuída.
3. O backend Windows envolve três funções: `registerCanonicalSimpleTrip` (evidência SCS e registro transacional), `updateWorkModeAvailability` (controle Senior de manutenção incluindo ETS2/ATS) e `operationalCommand` (política de início). A política `operationalWorkModePolicy` é um módulo incorporado a essas funções, não uma função publicável separada. O estado e os comprovantes da publicação desta continuação ficam em `verification/windows-activation-2026-11-01`. Publicação e estado ativo não equivalem a uma entrega autenticada com o jogo real.
4. Conferir a disponibilidade de PRO para `ets2`/`ats` em `settings/system.workModeAvailability`. A autorização da empresa, a identidade, o simulador e o limite continuam verificados na transação do servidor.

Para reproduzir uma publicação autorizada, após autenticar a CLI, instalar as dependências e aprovar a fonte atual no QA:

```powershell
npm run qa
npx -y firebase-tools@15.34.2 deploy --only functions:registerCanonicalSimpleTrip,functions:updateWorkModeAvailability,functions:operationalCommand --project vtc-frota-log --non-interactive
```

Essa publicação não é necessária para os ajustes da 0.1.4; o backend não foi modificado nesta revisão. Esse comando publica somente as três funções indicadas. Não cria viagens de teste em produção nem altera os controles de manutenção por si só. Nas atualizações do controle Senior, campos omitidos por versões antigas do cliente preservam o estado anterior; a versão esperada evita sobrescrever uma alteração concorrente.

O SDK reporta receita efetiva em unidades inteiras da moeda interna. Os próprios headers da SCS documentam **EUR para ETS2** e **USD para ATS**, independentemente da moeda escolhida para exibição no jogo. A distância `distance.km` já chega em quilômetros. Não há conversão automática para reais.

## Utilização

1. Instale a NVU por usuário e faça login pelo navegador do sistema.
2. Abra **PRO Windows**, localize os jogos e instale explicitamente o plugin em cada um, com os jogos fechados. O destino é `bin/win_x64/plugins/nvu_scs_telemetry.dll`. Reinicie o jogo e aceite o aviso de plugin da SCS, se apresentado.
3. Selecione a empresa e uma operação iniciada do simulador correto. Clique **Ativar PRO**. O frete atual é vinculado à operação; nenhum frete anterior sem vínculo é importado.
4. Ctrl+N abre/oculta o assistente. Todas as ações usam mouse, incluindo fechar no ×, alternar claro/escuro pelo sol/lua e arrastar o cabeçalho. Não há navegação por Tab, setas, Enter, espaço ou Esc, nem atalhos de navegação anteriores. A camada aberta recebe o mouse na área útil do monitor; o jogo pode pausar ao perder o foco. O clique fora do card não fecha a camada. Para dirigir, oculte ou escolha Voltar ao simulador. Com painel oculto os avisos continuam sem capturar cliques.
5. Esta edição atualiza também a DLL para 0.1.4. Feche o jogo, atualize o plugin em PRO → Simuladores e reabra-o. Não apague os dados da NVU. O aplicativo detecta o plugin antigo ainda carregado e exige a preparação/reinício.
6. A viagem atual só mostra rota de um frete ativo, com heartbeat válido e vínculo no contexto correto. A captura local da entrega já remove a rota, mesmo se chegar outro heartbeat antigo marcando o mesmo UUID como ativo. A última confirmação permanece identificada como encerrada. Distâncias: restante do GPS (`truck.navigation.distance`, float em metros, convertido para km) ou distância planejada do frete (`planned_distance.km`, u32 em km); sem dado, fica indisponível. Exibição em mi no ATS e km no ETS2, sem alterar a distância canônica registrada em km. Essa unidade de interface não é uma leitura da preferência de unidade do jogo.
7. A entrega vai para o diário durável, depois para a fila compartilhada da NVU. Somente a confirmação canônica do servidor altera o progresso confirmado. Ao atingir a meta, finalize a operação no fluxo existente.

O cartão pode não aparecer sobre tela cheia exclusiva. Não há injeção gráfica, alteração do executável dos jogos ou desativação de proteções. Não há suporte declarado para TruckersMP ou versões modificadas sem validação própria.

Se a instalação do plugin falhar por acesso à pasta, peça ao administrador para copiar somente a DLL NVU para o destino indicado. Não é necessário executar permanentemente a NVU ou o jogo como administrador. Para remover pelo aplicativo, a DLL precisa corresponder ao recibo de instalação NVU; arquivos alterados ficam preservados para revisão. A desinstalação da NVU conserva seus dados locais e não remove silenciosamente os plugins dos jogos: remova-os pelo painel antes de desinstalar.

## Consistência e limites

O SDK não fornece um identificador global de frete apropriado à idempotência. O plugin cria um UUID, preserva-o durante a viagem e em reinícios compatíveis com a mesma configuração de frete (rota, carga, empresas e prazo). Cada entrega produz um arquivo imutável. O backend usa a identidade por motorista/simulador/evento, independente da operação: uma tentativa não pode migrar para outro contrato ou empresa.

Essa identidade cobre replay da **mesma captura**, não prova que duas instalações independentes ou saves manipulados correspondem ao mesmo frete real. Telemetria permanece `client_reported_sdk`, sem promessa de inviolabilidade contra fraude. O servidor verifica coerência, vínculo, simulador, disponibilidade, capacidade e duplicidade de evento. Não atribui à telemetria a classificação de OCR de comprovante.

Entregas incompletas ou ocorridas durante pausa explícita ficam em conferência. O lançamento com OCR de ETS2/ATS existente permanece acessível para revisão manual do comprovante. Essa revisão não transforma automaticamente uma evidência incompleta em entrega confirmada, e deve ser conciliada pelo operador para evitar um lançamento manual adicional de uma captura já confirmada.

A comunicação plugin/aplicativo usa arquivos JSON de até 16 KiB em `%LOCALAPPDATA%\NVU\pro-telemetry`, com ACL limitada ao usuário Windows e SYSTEM, token local, versão, sequência e heartbeat. A conexão expira em 5 segundos. O diário do aplicativo fica em `%APPDATA%\NVU PRO\pro-journal.json`. Não apague essas pastas para tentar corrigir uma pendência.

O token Google de renovação é protegido pelo armazenamento do Windows (`safeStorage`/DPAPI); a sessão Firebase do renderer utiliza persistência em memória. Credenciais não são gravadas nos logs. A comunicação local não protege contra um processo malicioso executado com a mesma identidade Windows.

## Validação e assinatura

`npm run test:windows` cobre diário, replay, troca de contexto, pausa, heartbeat, eventos incompletos, Steam, proteção de outros plugins, monitores e OAuth com transportes/chaves controlados. `qa/tests/windows-scs.mts` usa o escritor real em Firestore local para ETS2/ATS. Nenhum desses ensaios comprova login Google real ou os jogos.

O instalador de teste é **sem assinatura Authenticode**. Windows/SmartScreen pode alertar por editor não reconhecido. Não desative proteções; confira a origem e o SHA-256. Para distribuição pública, configure assinatura legítima no empacotamento e execute a matriz Windows/jogos abaixo.

Pendências obrigatórias para aprovação de produção:

- Instalação e remoção no Windows real, com e sem acesso à pasta Steam.
- OAuth real do projeto Firebase, restauração e logout.
- Entregas completas em ETS2 e ATS, cancelamento, pausa e entregas consecutivas.
- Alt+Tab, reinício do jogo/app, entrega pendente e perda de rede/ACK.
- Janela, janela sem bordas, tela cheia exclusiva documentada, DPI e múltiplos monitores.
- Consumo de CPU/memória e ausência de interferência nos controles do jogo.
- Conferência da publicação do backend e validação autenticada do contrato com o cliente Windows real.

## Proveniência

SCS SDK 1.16, API de telemetria 1.01: `https://download.eurotrucksimulator2.com/scs_sdk_1_16.zip`.
SHA-256 do arquivo original: `49821e25568f4d7e462135f577f8fef2ab197326404f2c1daef139b8f3dc5e69`.
Headers, licença MIT e documentação original estão em `plugin/vendor`.
Eventos/atributos usados: `truck.navigation.distance` (float em metros), `planned_distance.km` (u32 em km), `job`, `job.delivered`, `job.cancelled`, `source.city`, `destination.city`, `revenue` (s64), `distance.km` (float), `delivery.time`, `started` e `paused`.

Referências oficiais: https://modding.scssoft.com/wiki/Documentation/Engine/SDK/Telemetry · https://www.electronjs.org/docs/latest/tutorial/security · https://developers.google.com/identity/protocols/oauth2/native-app


## Compilação cruzada opcional do plugin

Em Linux com CMake e MinGW x64 POSIX disponíveis no PATH:

```bash
NVU_WINDOWS_CROSS=1 npm run windows:plugin
```

A entrega 0.1.4 foi compilada com o pacote Ubuntu MinGW `13.2.0-6ubuntu1+26.1`, CMake `3.28.3-1build7`, ligação estática de libgcc/libstdc++ e API oficial SCS 1.01. A compilação não executa o plugin em um simulador. Registros de compilação e hashes acompanham o relatório da revisão.

## Histórico 0.1.2 — controle flutuante substituído na 0.1.3

Feche a NVU anterior pela bandeja e feche ATS/ETS2 antes de atualizar. Abra a candidata 0.1.2, confira a versão em PRO Windows, localize o jogo e escolha Atualizar plugin. Abra novamente o simulador e aceite o aviso de plugin da SCS quando apresentado. A nova DLL precisa ser instalada em cada jogo: atualizar somente a NVU não troca o arquivo já instalado no simulador.

O PRO agora verifica a instalação e a versão do plugin antes de iniciar. A pasta escolhida manualmente é preservada. O diagnóstico diferencia pasta não configurada, plugin ausente/desatualizado, plugin anterior ainda carregado, jogo fechado, ausência de sinal e heartbeat expirado. Abrir o jogo continua separado de confirmar uma conexão por telemetria.

O botão NVU é uma janela circular de 64 DIP; o menu de ações usa outra janela compacta. Transparência e passagem de cliques são controladas nativamente pela posição do cursor, sem hooks no jogo. O menu recolhe ao sair com o ponteiro, pelo botão de fechar ou por Ctrl+Alt+N. A posição é limitada à área útil e recuperada após desconectar um monitor.

Ações: ativar/pausar/retomar PRO, abrir o simulador da operação, painel, viagens filtradas da operação, conexão e plugin, encerrar PRO com confirmação. Encerrar PRO preserva pendências e não cancela a operação. Comandos antigos são recusados após trocar de contexto. Viagens usa o componente de histórico existente com a operação e o motorista atuais.

Em Conexão e plugin, Ver diagnóstico mostra o estado local e as últimas linhas relevantes de game.log.txt. Copiar diagnóstico copia esse resumo para envio manual ao suporte. Nenhum diagnóstico é enviado automaticamente; tokens e identificação pessoal das linhas são removidos. Logs em um diretório de jogo personalizado por -homedir podem não ser encontrados automaticamente.

O plugin 0.1.2 registra inicialização, falha da ponte e recuperação usando a API de log SCS exclusivamente nas callbacks do jogo. O worker faz somente I/O próprio; a API SCS não é chamada de outra thread. O frete pode ser vinculado com o jogo pausado; a pausa explícita do PRO fecha o intervalo autorizado. Repetir a configuração terminal do mesmo frete não cria outra identidade enquanto não houver transição para um novo frete.

As imagens do usuário comprovam abertura da aplicação e visibilidade da sobreposição sobre ATS, com telemetria desconectada na versão anterior. A causa no PC não é confirmada sem os novos diagnósticos. A suíte exercita comandos reais, ponte por arquivos e interface real com APIs Windows/Steam controladas; ela não comprova entrega completa no jogo.

## Histórico 0.1.3 — substituído pela 0.1.4

Feche a NVU antiga pela bandeja e abra a 0.1.3. Selecione sua empresa/operação e ative ou retome o PRO. O plugin permanece exatamente na versão 0.1.2; não reinstale uma DLL já atualizada apenas pela mudança da interface. Plugin antigo/ausente ainda exige preparação com o jogo fechado e reabertura do simulador.

O assistente permanece aberto ao sair com o cursor, perder foco, pausar ou trocar de aba. Ocultar, Esc e voltar ao jogo são ações explícitas. Navegação para painel/histórico/ajustes abre a tela solicitada da aplicação. A aba nativa de viagens mostra capturas deste computador; o histórico completo usa o filtro da operação existente.

Os avisos diferenciam frete vinculado com rota, entrega salva, envio, confirmação, conferência, cancelamento e conexão. Viagem registrada só aparece após reconhecimento do servidor. O card mostra receita efetivamente recebida em EUR/USD e quilômetros disponíveis. Progresso continua vindo do servidor. ACK repetido não duplica aviso. Pendências permanecem no contexto original; avisos antigos são removidos ao trocar de conta/operação.

O painel é opaco e focável, com entrada por mouse/teclado; avisos usam janela transparente não focável e ignoram todos os cliques. Não há polling do cursor a 20 Hz: inspeção/expiração é feita a 1 Hz. Posição antiga do botão é migrada para dimensões de painel, limitada às áreas úteis em DIP. Notificações aparecem no topo central do monitor do cursor quando criadas. Tema é recebido por IPC validado e persistido. Os ajustes são organizados em Viagem, Simuladores e Como usar; diagnóstico fica recolhido para suporte.

As imagens do usuário comprovam ATS conectado na 0.1.2 com interação defeituosa. A 0.1.3 remove as causas no código. Testes controlados de foco/atalhos/Win32 e Chromium não comprovam comportamento dentro de ETS2/ATS reais. Essa homologação continua pendente. Instalador e DLL permanecem sem assinatura Authenticode.
