# NVU PRO Windows 0.2.0

Aplicativo Windows (Electron) e plugin de telemetria SCS (ETS2/ATS) do mesmo projeto Web/Android. Este documento é técnico; o guia para o usuário final é `GUIA-ATUALIZAR-NVU-E-PREPARAR-ETS2-ATS.md`.

> **Estado desta edição:** candidata. Testada de forma automatizada/controlada (Linux), no **Windows real** (GitHub Actions: build com MSVC, 89 testes, instalador, instalação/atualização/desinstalação, instância única, elevação do plugin e troca da 0.1.4 antiga em execução) e, para o instalador, no Wine. **Não foi executada nos jogos** (ETS2/ATS) e **não está assinada digitalmente**. Distribuição sem custo e assinatura: `ASSINATURA-E-LIBERACAO.md`; roteiro nos jogos: `ROTEIRO-TESTE-ETS2-ATS.md`.

## Entrega

| Arquivo | Para quem |
|---|---|
| `NVU-PRO-Setup-0.2.0-x64.exe` | **Principal.** Instala ou atualiza a NVU (por usuário, sem administrador). |
| `release-manifest.json`, `SHA256SUMS.txt`, `Verificar-NVU.ps1` | Conferência do arquivo baixado (tamanho, SHA-256, assinatura). |
| `nvu_scs_telemetry.dll` + `.manifest.json` e `plugin/` (fonte) | Opcional/técnico: plugin e fonte do plugin. |
| Projeto completo (ZIP) e relatório | Opcional/técnico. |

Fluxo do usuário: instalar/atualizar NVU → entrar com a conta Google → **PRO → Simuladores → Preparar simulador** → abrir o jogo → iniciar a operação.

## Comandos (na raiz do projeto)

```powershell
npm ci
npm --prefix functions ci
npm run windows:setup                 # npm ci em desktop/windows
npm run windows:plugin                # compila o plugin (MSVC no Windows; NVU_WINDOWS_CROSS=1 usa MinGW em Linux)
npm run test:windows                  # testes de desktop/windows (Node)
npm run qa                            # bateria completa (ver qa/README.md)
npm run windows:installer             # build Web + unpacked + instalador + verificações + release-manifest.json
npm run windows:verify                # reverifica artifacts/windows (tamanho, SHA-256, CRC do NSIS, certificado, 7-Zip)
npm run windows:portable              # secundário: ZIP sem instalação
npm run windows:dev                   # abre o aplicativo a partir do código
npm run test:role-matrix              # matriz por papel (emulador, dados fictícios)
bash desktop/windows/tests/e2e/wine-installer-check.sh artifacts/windows/NVU-PRO-Setup-0.2.0-x64.exe ~/wine-nvu   # emulado (Wine), prefixo descartável
```

A versão do aplicativo e do plugin vem de **uma única fonte**: `desktop/windows/package.json` (`version` e `nvu.pluginVersion`). O build do plugin grava a versão na DLL e gera `nvu_scs_telemetry.manifest.json` (SHA-256/tamanho); o aplicativo confere a DLL empacotada com esse manifesto ao iniciar.

## Arquitetura

| Parte | Arquivo | Função |
|---|---|---|
| Entrada e etapas | `main.cjs` | Linha de comando, bloqueio de instância, etapas de inicialização, IPC. |
| Instância única | `core/instance.cjs`, `core/process-list.cjs` | Quem perde o bloqueio só decide e sai. Troca de versão só com consentimento e só para processo NVU verificado (pacote `nvu-windows`). |
| Inicialização | `core/startup.cjs`, `core/errors.cjs`, `core/logging.cjs`, `core/redact.cjs` | Etapas com código `NVU-Sxxx`, ação recomendada, registro em `%APPDATA%\NVU PRO\logs`, diagnóstico copiável sem dados pessoais. |
| Versões | `core/versions.cjs` | App, interface (`nvu-build.json`) e plugin esperado/empacotado reais. |
| Plugin | `core/plugin-install.cjs`, `core/prepare.cjs`, `core/elevated-plugin.cjs`, `core/integration.cjs` | Preparar simulador, estados do plugin, elevação consentida. |
| Telemetria | `core/session.cjs`, `core/assistant.cjs`, `plugin/nvu_scs_telemetry.cpp` | Diário durável, vínculo, heartbeat, assistente. |
| Instalador | `installer/nvu.nsi`, `build-installer.cjs`, `tools/*` | NSIS, assinatura, verificações. |

### Linha de comando de `NVU PRO.exe`

| Opção | Efeito |
|---|---|
| `--nvu-no-dialogs` | Suporte/automação: nunca abre caixas; decisões vão para o registro e o código de saída (`0` já aberta, `3` dono desconhecido, `4` outra versão mantida, `5` troca falhou). |
| `--nvu-replace-running` | Automação: se outra versão da NVU estiver aberta, assume o lugar dela sem perguntar (só processo NVU verificado). |
| `--nvu-versions-out=<arquivo>` | Grava as versões reais (app, interface, plugin) em JSON e sai, sem janela. |
| `--nvu-elevated-plugin=<pedido>` | Interno: cópia do plugin com permissão elevada. Valida o pedido, usa só a DLL do próprio pacote e responde pelo código de saída. |

### Instalador

`NVU-PRO-Setup-<versão>-x64.exe /S` instala em silêncio (`/D=C:\pasta` escolhe o destino). Atualiza no mesmo lugar (executa o desinstalador anterior com `_?=`, preservando configurações e viagens). Se a NVU estiver aberta **naquela pasta**, pergunta; em modo silencioso recusa com código `5`, ou fecha somente esse processo com `/FORCECLOSE`. Outros programas — inclusive outros aplicativos Electron e outras cópias do NVU em outras pastas — nunca são tocados (identificação pelo caminho completo da imagem). O desinstalador preserva `%APPDATA%\NVU PRO` e `%LOCALAPPDATA%\NVU`; `/PURGE` (silencioso) ou a resposta "Sim" os remove.

### Elevação do plugin

Aplicativo e jogos rodam com permissões normais. Só quando o Windows nega a gravação na pasta do jogo a interface pede consentimento e a NVU reabre a si mesma com `Start-Process -Verb RunAs` para **copiar um único arquivo**: a DLL do próprio pacote, conferida contra o manifesto e o hash pedido, para `<jogo>\bin\win_x64\plugins\nvu_scs_telemetry.dll`, recusando links/junções, arquivos de terceiros e qualquer outro caminho. O resultado volta só pelo código de saída; o aplicativo relê o disco sem privilégios antes de dizer "preparado".

## Validação (o que cada nível comprova)

| Nível | O que foi executado | O que comprova |
|---|---|---|
| Automatizado/controlado (Linux) | `npm run test:windows` (89 testes), `npm run qa`, matriz por papel (40 cenários, emulador), UI em Chromium | Lógica, contratos, mensagens, políticas. **Não** comprova Windows nativo. |
| Emulado (Wine 9 sobre Linux) | `bash desktop/windows/tests/e2e/wine-installer-check.sh <instalador.exe> <prefixo-wine>`: instalação, atualização, desinstalação (dados preservados); recusa com a NVU aberta; `/FORCECLOSE`; programa homônimo em outra pasta preservado; aplicativo empacotado informando versões reais; 2ª execução perde o bloqueio, não roda etapas e sai | O código do NSIS e a decisão de instância única do aplicativo empacotado executam. **Não é Windows**: o Electron não chega a criar a janela sob este Wine (um aplicativo Electron mínimo trava no mesmo ponto), então nada de interface é comprovado aqui. |
| Windows real (GitHub Actions) | `.github/workflows/windows-ci.yml` (push em `claude/**` com `[win-ci]` no último commit, ou *Run workflow* quando o arquivo estiver na `main`) | Plugin MSVC (tabela de exportação e importações conferidas), 89 testes, instalador e verificação, instalar/atualizar/desinstalar, instância única, janela e inicialização saudável (15 etapas), elevação do plugin, troca sobre a 0.1.4 real, `Verificar-NVU.ps1` no PowerShell 5.1 (como o usuário abre) e no 7, inclusive com arquivo adulterado, e ensaio de assinatura com certificado descartável. **Executado com sucesso** (ver o relatório). Não cobre entrada nativa do assistente, jogos nem o antivírus do PC do usuário. |
| Jogos reais | — | **Não executado.** |

## Assinatura

O pipeline assina `NVU PRO.exe`, a DLL do plugin, o instalador e (em host Windows) o desinstalador, com SHA-256 + carimbo de tempo RFC 3161, e regenera o manifesto do plugin sobre os bytes assinados. Credenciais só por variáveis de ambiente/segredos (`NVU_SIGN_PFX_BASE64`+`NVU_SIGN_PFX_PASSWORD`, ou `NVU_SIGN_COMMAND_JSON` para SignPath/KeyLocker/Azure Trusted Signing). **Sem credenciais o resultado é "não assinado" com o motivo exato** e `release-manifest.json` marca `productionReady: false`. Certificado autoassinado (usado só no ensaio do CI) não comprova assinatura pública. Assinar não promete ausência de alerta do SmartScreen.

## Segurança e dados

- Ponte local plugin↔aplicativo: arquivos JSON de até 16 KiB em `%LOCALAPPDATA%\NVU\pro-telemetry`, ACL limitada ao SID do usuário e SYSTEM (via `whoami`/`icacls`, sem PowerShell), chave local de 256 bits recriada se ilegível.
- Diário de viagens: `%APPDATA%\NVU PRO\pro-journal.json` (escrita atômica). Diário ilegível: o arquivo é preservado, uma cópia é feita ao lado e o código `NVU-S050` é mostrado.
- Token Google: DPAPI via `safeStorage`; credencial revogada é removida, falha de rede **não** apaga a sessão salva.
- Telemetria é `client_reported_sdk`: não é prova inviolável contra fraude.
