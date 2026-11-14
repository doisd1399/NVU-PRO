# NVU PRO Windows — candidata 0.1.0

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

O pacote será escrito em `artifacts/windows`. O empacotamento usa electron-builder para a aplicação e NSIS 3.12 (bundle 1.2.1 verificado por SHA-256) para instalação/desinstalação por usuário. O script não executa arquivos Windows durante a compilação e também funciona em um host Linux, sem Wine. A desinstalação remove somente os arquivos listados na entrega, preservando dados e plugins. A DLL compilada acompanha o código em `desktop/windows/plugin/bin/nvu_scs_telemetry.dll`. O build CMake com MSVC pode gerar bytes diferentes da compilação MinGW incluída. Mantenha o executável e a DLL da mesma entrega.

## Configurações externas necessárias

1. Criar um cliente OAuth **Desktop** no projeto Google associado ao Firebase da NVU. Configurar os clientes autorizados no Firebase/Google conforme a documentação do provedor. O cliente Web/Android existente não substitui esse cadastro.
2. Preencher `desktop/windows/config/google-oauth.json` com `clientId` e, se o fluxo do cliente Desktop exigir, `clientSecret`, antes de empacotar. Alternativamente, o administrador pode fornecer `%APPDATA%\NVU PRO\google-oauth.json`, ou as variáveis `NVU_GOOGLE_DESKTOP_CLIENT_ID` e `NVU_GOOGLE_DESKTOP_CLIENT_SECRET`. O instalador entregue não contém uma credencial Desktop inventada; o login informa a configuração ausente.
3. Publicar a versão atualizada de `registerCanonicalSimpleTrip` e `operationalWorkModePolicy` pelo processo normal de implantação, após revisão e testes. Esta entrega não publica serviços de produção. O backend antigo rejeita o novo campo `scsTelemetry` e a viagem fica preservada na fila.
4. Conferir a disponibilidade de PRO para `ets2`/`ats` em `settings/system.workModeAvailability`. A autorização da empresa, a identidade, o simulador e o limite continuam verificados na transação do servidor.

O SDK reporta receita efetiva em unidades inteiras da moeda interna. Os próprios headers da SCS documentam **EUR para ETS2** e **USD para ATS**, independentemente da moeda escolhida para exibição no jogo. A distância `distance.km` já chega em quilômetros. Não há conversão automática para reais.

## Utilização

1. Instale a NVU por usuário e faça login pelo navegador do sistema.
2. Abra **PRO Windows**, localize os jogos e instale explicitamente o plugin em cada um, com os jogos fechados. O destino é `bin/win_x64/plugins/nvu_scs_telemetry.dll`. Reinicie o jogo e aceite o aviso de plugin da SCS, se apresentado.
3. Selecione a empresa e uma operação iniciada do simulador correto. Clique **Ativar PRO**. O frete atual é vinculado à operação; nenhum frete anterior sem vínculo é importado.
4. Prefira janela sem bordas. O cartão flutuante exibe conexão, progresso confirmado e pendências. `Ctrl+Alt+N` mostra/oculta; `Ctrl+Alt+P` abre o painel. O ícone da bandeja permite reabrir ou sair da NVU.
5. A entrega vai para o diário durável, depois para a fila compartilhada da NVU. Somente a confirmação canônica do servidor altera o progresso confirmado. Ao atingir a meta, finalize a operação no fluxo existente.

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
- Deploy e validação do contrato de backend atualizado.

## Proveniência

SCS SDK 1.16, API de telemetria 1.01: `https://download.eurotrucksimulator2.com/scs_sdk_1_16.zip`.
SHA-256 do arquivo original: `49821e25568f4d7e462135f577f8fef2ab197326404f2c1daef139b8f3dc5e69`.
Headers, licença MIT e documentação original estão em `plugin/vendor`.
Eventos/atributos usados: `job`, `job.delivered`, `job.cancelled`, `source.city`, `destination.city`, `revenue` (s64), `distance.km` (float), `delivery.time`, `started` e `paused`.

Referências oficiais: https://modding.scssoft.com/wiki/Documentation/Engine/SDK/Telemetry · https://www.electronjs.org/docs/latest/tutorial/security · https://developers.google.com/identity/protocols/oauth2/native-app
