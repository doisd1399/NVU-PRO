# NVU PRO Windows 0.2.13

Aplicativo Windows (Electron) e plugin de telemetria SCS (ETS2/ATS) do mesmo projeto Web/Android. Este documento é técnico; o guia para o usuário final é `GUIA-ATUALIZAR-NVU-E-PREPARAR-ETS2-ATS.md`.

> **Estado desta edição:** candidata. Testada de forma automatizada/controlada (Linux), no **Windows real** (GitHub Actions: build com MSVC, 95 testes, instalador, instalação/atualização/desinstalação, instância única, elevação do plugin e troca da 0.1.4 antiga em execução) e, para o instalador, no Wine. **Não foi executada nos jogos** (ETS2/ATS) e **não está assinada digitalmente**. Distribuição sem custo e assinatura: `ASSINATURA-E-LIBERACAO.md`; roteiro nos jogos: `ROTEIRO-TESTE-ETS2-ATS.md`.

## Entrega

| Arquivo | Para quem |
|---|---|
| `NVU-PRO-Setup-0.2.13-x64.exe` | **Principal.** Instala ou atualiza a NVU (por usuário, sem administrador). |
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
bash desktop/windows/tests/e2e/wine-installer-check.sh artifacts/windows/NVU-PRO-Setup-0.2.13-x64.exe ~/wine-nvu   # emulado (Wine), prefixo descartável
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
| Aviso de versão nova | `core/update-check.cjs` | Lê a lista pública de releases do repositório e **só avisa** (banner na aba Viagem e item na bandeja); nunca baixa nem instala. Detalhes em *Segurança e dados*. |

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

## Configurações externas (login Google e servidor)

### Login Google
- O cliente OAuth é do tipo **Desktop** (público, com PKCE), do projeto Firebase `vtc-frota-log`. Para qualquer pessoa entrar, a tela de consentimento OAuth precisa estar **«Em produção»** (em «Teste» só entram os e-mails cadastrados).
- Ordem de leitura da configuração: variáveis de ambiente `NVU_GOOGLE_DESKTOP_CLIENT_ID` / `NVU_GOOGLE_DESKTOP_CLIENT_SECRET` → `%APPDATA%\NVU PRO\google-oauth.json` (se existir) → `config/google-oauth.json` empacotado. Confira configurações locais antigas ao atualizar.
- No Git, `config/google-oauth.json` tem o `clientSecret` **vazio de propósito** (o repositório é público). O instalador com login só sai do fluxo da comunidade, que grava o arquivo a partir dos Secrets do ambiente `windows-release`. Para compilar localmente, preencha `clientId` e `clientSecret` (iguais a `installed.client_id` e `installed.client_secret` do JSON baixado do Google) **sem commitar**.

### Servidor (Firebase `vtc-frota-log`)
O app Windows depende de três funções, cujo código está em `functions/src`:

| Função | Papel |
|---|---|
| `registerCanonicalSimpleTrip` | aceita e valida a evidência SCS (`source: PRO_WINDOWS_SCS`, `scsTelemetry`; módulo `scsTelemetryEvidence.ts`) e registra a viagem de forma transacional |
| `updateWorkModeAvailability` | controle Senior de manutenção por modo e simulador, incluindo ETS2/ATS (campos omitidos por clientes antigos preservam o estado anterior) |
| `operationalCommand` | comandos operacionais (iniciar, cancelar…); a política de modos inclui ETS2/ATS no modo PRO |

`operationalWorkModePolicy` é um módulo incorporado a essas funções, não uma função publicável separada. A publicação das três em 2026-11-01 está documentada em `verification/windows-activation-2026-11-01`; função publicada e ativa não equivale a uma entrega autenticada com o jogo real.

**Publicar só com autorização explícita do dono do projeto.** Procedimento: `npm run qa` aprovado na fonte atual; guardar a lista de funções (nome, estado e hash) antes; publicar apenas as funções necessárias; conferir depois que a quantidade de funções é a mesma, que só as indicadas mudaram, que estão ACTIVE e que uma chamada sem login é recusada pela própria função.

```powershell
npx -y firebase-tools@15.34.2 deploy --only functions:registerCanonicalSimpleTrip,functions:updateWorkModeAvailability,functions:operationalCommand --project vtc-frota-log --non-interactive
```

Esse comando publica somente as funções indicadas, não cria viagens de teste em produção e não altera os controles de manutenção por si só. Confira também a disponibilidade de PRO para `ets2`/`ats` em `settings/system.workModeAvailability`.

### Moeda e distância
O SDK reporta a receita efetiva em unidades inteiras da moeda interna do jogo: **EUR no ETS2** e **USD no ATS**, independentemente da moeda escolhida para exibição. `distance.km` já chega em quilômetros. Não há conversão automática para reais.

## Validação (o que cada nível comprova)

| Nível | O que foi executado | O que comprova |
|---|---|---|
| Automatizado/controlado (Linux) | `npm run test:windows` (95 testes), `npm run qa`, matriz por papel (40 cenários, emulador), UI em Chromium | Lógica, contratos, mensagens, políticas. **Não** comprova Windows nativo. |
| Emulado (Wine 9 sobre Linux) | `bash desktop/windows/tests/e2e/wine-installer-check.sh <instalador.exe> <prefixo-wine>`: instalação, atualização, desinstalação (dados preservados); recusa com a NVU aberta; `/FORCECLOSE`; programa homônimo em outra pasta preservado; aplicativo empacotado informando versões reais; 2ª execução perde o bloqueio, não roda etapas e sai | O código do NSIS e a decisão de instância única do aplicativo empacotado executam. **Não é Windows**: o Electron não chega a criar a janela sob este Wine (um aplicativo Electron mínimo trava no mesmo ponto), então nada de interface é comprovado aqui. |
| Windows real (GitHub Actions) | `.github/workflows/windows-ci.yml` (push em `claude/**` com `[win-ci]` no último commit, ou *Run workflow* quando o arquivo estiver na branch padrão do repositório) | Plugin MSVC (tabela de exportação e importações conferidas), 95 testes, instalador e verificação, instalar/atualizar/desinstalar, instância única, janela e inicialização saudável (15 etapas), elevação do plugin, troca sobre a 0.1.4 real, `Verificar-NVU.ps1` no PowerShell 5.1 (como o usuário abre) e no 7, inclusive com arquivo adulterado, aviso de versão nova no aplicativo instalado (consulta real ao GitHub, desligamento e intervalo gravado) e ensaio de assinatura com certificado descartável. **Executado com sucesso** (ver o relatório). Não cobre entrada nativa do assistente, jogos nem o antivírus do PC do usuário. |
| Versão da comunidade (sem assinatura) | `.github/workflows/windows-community-release.yml`: push na `dist-build` com `[win-comunidade]` no último commit (release real, ambiente `windows-release`, termina em rascunho) ou `[win-community-ensaio]` em `claude/**` (ensaio sem Secrets, ambiente `windows-ensaio`) | Constrói, testa, instala e confere; o release real ainda **não foi executado** (precisa dos Secrets). Passo a passo em `ASSINATURA-E-LIBERACAO.md`. |
| Jogos reais | — | **Não executado.** |

## Assinatura

O pipeline assina `NVU PRO.exe`, a DLL do plugin, o instalador e (em host Windows) o desinstalador, com SHA-256 + carimbo de tempo RFC 3161, e regenera o manifesto do plugin sobre os bytes assinados. Credenciais só por variáveis de ambiente/segredos (`NVU_SIGN_PFX_BASE64`+`NVU_SIGN_PFX_PASSWORD`, ou `NVU_SIGN_COMMAND_JSON` para SignPath/KeyLocker/Azure Trusted Signing). **Sem credenciais o resultado é "não assinado" com o motivo exato** e `release-manifest.json` marca `productionReady: false`. Certificado autoassinado (usado só no ensaio do CI) não comprova assinatura pública. Assinar não promete ausência de alerta do SmartScreen.

## Segurança e dados

- Ponte local plugin↔aplicativo: arquivos JSON de até 16 KiB em `%LOCALAPPDATA%\NVU\pro-telemetry`, ACL limitada ao SID do usuário e SYSTEM (via `whoami`/`icacls`, sem PowerShell), chave local de 256 bits recriada se ilegível.
- Diário de viagens: `%APPDATA%\NVU PRO\pro-journal.json` (escrita atômica). Diário ilegível: o arquivo é preservado, uma cópia é feita ao lado e o código `NVU-S050` é mostrado.
- **Offline (limites honestos):** abre e mantém a sessão; mostra perfil, fotos já vistas e os dados que as telas guardam para o primeiro quadro. **Não** há cache persistente do Firestore em nenhuma plataforma (desligado de propósito: erro de cota virava falha de sessão), e ligar só no Windows reaplicaria escritas pendentes depois de reiniciar; por isso listas e dados novos exigem internet. 12 pontos do app leem direto do servidor (`getDocFromServer`) e falham offline por desenho. Não foi feita verificação automatizada de todas as telas offline: foi testado à mão apenas abrir sem internet e fotos.
- Sessão do Firebase: guardada no disco (IndexedDB da pasta de dados do usuário), como no Android, para o aplicativo **abrir sem internet** com o perfil e as fotos já vistas; **Sair** apaga. Dados novos e listas ainda exigem internet (o cache do Firestore é só em memória em todas as plataformas), e as viagens do jogo continuam sendo salvas e enviadas depois.
- Token Google: DPAPI via `safeStorage`; credencial revogada é removida, falha de rede **não** apaga a sessão salva.
- Aviso de versão nova: no aplicativo instalado, no máximo **uma consulta HTTPS anônima a cada 12 h** (30 min depois de uma falha) a `api.github.com/repos/doisd1399/NVU-PRO/releases` — endereço fixo, sem redirecionamento, 8 s de limite, resposta de até 512 KiB, sem cookies nem dados da conta (o GitHub enxerga o IP, como em qualquer download). Só vale release **publicado** (nunca rascunho) com tag `windows-comunidade-vX.Y.Z[-runN]`; o link mostrado nasce da tag validada, nunca da resposta, e abrir a página exige o mesmo endereço. Nada é baixado nem instalado: o botão **Ver novidades** só abre a página oficial. Estado em `%APPDATA%\NVU PRO\update-check.json`. Não roda em desenvolvimento (aplicativo não empacotado) nem com `NVU_NO_UPDATE_CHECK=1` (variável de ambiente do usuário ou da empresa); o CI a define para os testes não usarem a internet.
- Política de segurança da interface (CSP, em `main.cjs`): só `nvu://`, sem scripts externos, e conexões apenas ao Google/Firebase/Cloudinary. `data:` e `blob:` valem **só em `connect-src`**, para o app ler a foto guardada no aparelho e enviá-la (foto do veículo e capa); sem isso o envio ficava "pendente" para sempre. Coberto por `tests/renderer-runtime.test.cjs`.
- Telemetria é `client_reported_sdk`: não é prova inviolável contra fraude.
