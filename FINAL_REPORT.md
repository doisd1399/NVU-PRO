# Relatório final — NVU PRO Official Baseline

## Conclusão

O novo repositório privado **NVU-PRO** foi criado e publicado na branch `main`. A árvore é limpa, não contém backups, APKs, builds gerados, keystore ou segredos, e reproduz o build Web e a sincronização Capacitor com runtime local. Após o recebimento dos arquivos privados, o APK Android Release foi compilado, assinado e validado com sucesso. A tag oficial `v1.0.359-release` será criada a partir do commit que contém este relatório atualizado.

## Identidade

| Campo | Resultado |
|---|---|
| Nome solicitado | NVU PRO |
| Slug GitHub | `NVU-PRO` |
| Repositório | [doisd1399/NVU-PRO][1] |
| Visibilidade | Privado |
| Branch oficial | `main` |
| Commit da baseline publicada | `2a7af8134213455a39a355654bc1007544aed7a0` |
| Commit de documentação e validação | Será o commit publicado com este relatório |
| Tag oficial | `v1.0.359-release` |
| APK Release | `NVU-PRO-1.0.359-vc359-Release-signed.apk` |

O GitHub não usa espaços no slug de repositório; por isso, o nome técnico publicado é `NVU-PRO`, mantendo **NVU PRO** como identidade apresentada no README e na descrição do repositório.

## Base oficial

A fonte de código foi o arquivo `NVU-Pro-v1.2-full-project-backup.zip`, fornecido na pasta do Google Drive. O próprio relatório desse backup identifica o snapshot completo como o commit `2dc553ee5fdab1a93f8859ade3d3539aa484bc4e` do repositório histórico `doisd1399/NVU-ZZZ-Android-`.[2] O commit foi conferido diretamente no repositório histórico e corresponde à data `2026-09-16T10:56:09Z`.

O bundle `NVU-Pro-v1.2-local-build-bundle (1).zip` foi usado apenas para comparação. O código Web em `src/` e `scripts/`, o código Java nativo e os recursos Android foram comparados e ficaram idênticos ao snapshot completo. O APK presente nos três backups também foi comparado por SHA-256. O arquivo Golden tem SHA-256 `a77efea8849c1bdc950366d7ddb1370e155a6112f7ed83bca1767a8fec635a65`, `applicationId com.nvu.operacional`, `versionName 1.0.358`, `versionCode 358` e Web `2.3.141`.

Os arquivos originais permanecem preservados fora do repositório, em área privada de auditoria. O repositório histórico também foi clonado sem qualquer alteração destrutiva.

## Limpeza

A nova árvore foi construída a partir do projeto-fonte, não do APK. Foram deliberadamente excluídos do Git os três ZIPs de backup, o APK Golden, o Git bundle histórico, `dist/`, `node_modules/`, builds Android, arquivos Capacitor gerados, relatórios históricos, manifests de release antigos, logs, arquivos temporários, keystores e arquivos de configuração privados.

Foram mantidos o código Web, `public/`, configuração Firebase/Firestore, scripts de build e testes, plataforma Android, Gradle Wrapper, configurações Capacitor, regras de ignore, metadata público e documentação operacional. O arquivo `capacitor.remote.json` foi preservado como configuração histórica explícita e permanece desabilitado; ele não é usado como `server.url`.

A configuração privada `google-services.json` foi usada somente no ambiente local para o build Release e permanece ignorada pelo Git. O keystore e suas credenciais também permanecem fora do repositório.

## Alterações realizadas

### Alterações necessárias

A pasta Android foi normalizada de `android-project/` para `android/`, porque os scripts oficiais do snapshot e a configuração Capacitor esperam o caminho padrão `android/`. O build Web, a sincronização Capacitor e os gates de paridade passaram nessa estrutura.

A identidade nativa foi avançada de `versionCode 358` para `359` e de `versionName 1.0.358` para `1.0.359`. O canal nativo derivado passou de `production-358` para `production-359`. A versão Web permaneceu em `2.3.141`, sem mistura com outra versão Web.

O arquivo `android/variables.gradle` foi restaurado porque estava ausente no ZIP, mas era requerido pelo `android/build.gradle`; sem ele o Gradle não conseguia avaliar o projeto. Seus valores são a infraestrutura pública compatível identificada na origem histórica e não alteram comportamento da aplicação. Os scripts oficiais `android/gradlew` e `android/gradlew.bat` foram adicionados para acompanhar o `gradle-wrapper.jar` e a distribuição Gradle `8.14.3` já fornecidos.

A configuração de release OTA foi ajustada para que o runtime local continue sendo o padrão e a OTA self-hosted seja opt-in explícito. O gate `verify:ota-ready` foi adaptado para aceitar essa baseline local-only sem exigir URL remota em `package.json`. Foi criado `NVU_RELEASE_METADATA.json` com identidade pública e política de canal, sem chaves privadas.

Também foram adicionados `README.md`, este relatório e regras de `.gitignore` para impedir que saídas geradas do Capacitor, credenciais e artefatos de release sejam versionados.

### Alterações complementares recuperadas

Somente a infraestrutura Gradle ausente foi recuperada. Nenhum commit posterior foi aplicado em massa, nenhum cherry-pick foi feito e nenhum código histórico de login, perfil, PRO, MAX/GTO, captura, seleção de frete ou navegação foi substituído.

### Alterações não aplicadas

Não foram incorporadas as alterações funcionais dos commits posteriores ao snapshot oficial. Não foi usado o APK como fonte de código. Não foram copiados `dist` ou assets antigos para o commit. Não foram adicionados `google-services.json`, senhas, alias de keystore ou chaves OTA ao Git.

## Android

| Item | Resultado |
|---|---|
| `applicationId` | `com.nvu.operacional` |
| `versionName` | `1.0.359` |
| `versionCode` | `359` |
| Runtime inicial | Local, por assets Web empacotados |
| `server.url` | Ausente na configuração oficial |
| `webDir` | `dist` |
| Capacitor | Sincronizado com quatro plugins Android |
| System Bars | Configuração estrutural `LIGHT` preservada |
| Assinatura Release | PASS — APK assinado com alias `nvukey` |
| Certificado | PASS — SHA-256 `806a03ea92b69e7f9a70526e9c4d6a4ae52ec4f9cf7cac05ddb1aa28084246ea` |
| Navigation bar | **NÃO VALIDADO** em dispositivo/emulador |

A sincronização identificou `@capacitor-firebase/authentication`, `@capacitor/app`, `@capacitor/push-notifications` e `@capawesome/capacitor-live-update`. A aplicação inicia com Web local. A OTA, quando habilitada no futuro, deve usar canal derivado do `versionCode` e manifestos assinados; o runtime remoto não é o fallback de inicialização.

## Web

| Item | Resultado |
|---|---|
| Versão Web | `2.3.141` |
| Runtime revision | `R3.34-PC-WEB-AUTH-ARCHITECTURE-MODULAR` |
| Build | PASS — `npm run build` |
| Manifesto | Gerado em `dist/nvu-build.json` |
| Runtime do manifesto | `local` |
| OTA no build reproduzido | `false` |
| Assets Web gerados | 87 arquivos em `dist` |
| Assets Android após preparação | 88 arquivos, incluindo bridges Capacitor |
| Paridade `dist`/Android | PASS — SHA-256 semântico verificado pelo gate oficial |
| TypeScript | PASS — `npm run lint` / `tsc --noEmit` |

O build gerou `dist/nvu-build.json` com `capacitorRuntime: local`, `otaEnabled: false` e versão Web `2.3.141`. O manifesto embutido no APK acrescenta corretamente `nativeBundleImmutable: true`. Os avisos de chunk grande do Vite não impediram o build e não foram tratados como falha funcional.

## APK

O APK Release foi gerado fora do Git e validado com `apksigner`, `aapt2`, `keytool`, inspeção de assets e comparação semântica de manifestos.

| Verificação | Estado | Evidência |
|---|---|---|
| APK Release recém-gerado | PASS | `NVU-PRO-1.0.359-vc359-Release-signed.apk` |
| Assinatura | PASS | APK Signature Scheme v2; um signer |
| Alias | PASS | `nvukey` |
| Certificado | PASS | SHA-256 `806a03ea92b69e7f9a70526e9c4d6a4ae52ec4f9cf7cac05ddb1aa28084246ea` |
| Package | PASS | `com.nvu.operacional` |
| Version | PASS | `versionName 1.0.359`, `versionCode 359` |
| SHA-256 do APK | PASS | `679ffb26fb4dd6be495a6c25a318f9f984d3ac8206b89e83461ba206899f6f75` |
| Tamanho | PASS | 66.183.522 bytes |
| Web embutido | PASS | `assets/public/index.html` e `nvu-build.json` presentes |
| Runtime local | PASS | `capacitorRuntime=local`, `otaEnabled=false` |
| Canal OTA | PASS | `production-359` |
| Dependência de URL remota no boot | PASS | Nenhum `server.url`, Netlify ou `stirring-pavlova` no config nativo |
| APK Golden de referência | PASS como referência | SHA-256 `a77efea8849c1bdc950366d7ddb1370e155a6112f7ed83bca1767a8fec635a65` |

A assinatura usa o mesmo certificado do keystore recebido: `C=br, ST=rj, L=rio de janeiro, O=nvuzzz, OU=nvuzz, CN=NVU`. O APK não foi reempacotado depois da assinatura.

## Testes

| Teste | Estado | Evidência |
|---|---|---|
| Preservação dos três ZIPs e keystore | PASS | Hashes locais conferidos com os dados do Drive |
| Correspondência do APK Golden entre backups | PASS | Três cópias com SHA-256 idêntico |
| Código Web snapshot vs bundle local | PASS | `src/` e `scripts/` sem diferenças |
| Código Java/recursos Android snapshot vs bundle local | PASS | Sem diferenças nos diretórios auditados |
| `npm ci` | PASS | Dependências instaladas pelo lockfile |
| `npm run build` | PASS | Manifesto Web gerado e gate de release aprovado |
| `npx cap sync android` | PASS | Quatro plugins encontrados e assets copiados |
| `npm run prepare:cap-assets` | PASS | Fallback local preparado e OCR sem duplicidade |
| `npm run verify:cap-local` | PASS | Runtime local e revisão Web coerentes |
| `npm run verify:cap-assets` | PASS | Paridade entre Web e Android |
| `npm run verify:ota-ready` | PASS | OTAManager único e política local-only validada |
| `npm run lint` | PASS | `tsc --noEmit` sem erros |
| `./gradlew clean assembleRelease` | PASS | Gradle 8.14.3, Java 21, build concluído |
| `apksigner verify --verbose --print-certs` | PASS | Assinatura v2 válida |
| `aapt2 dump badging` | PASS | Package/version/SDK conferidos |
| Manifesto e assets do APK | PASS | Runtime local, canal 359, `nativeBundleImmutable` |
| Login, seleção de perfil e Firebase em dispositivo | **NÃO VALIDADO** | Requer dispositivo/emulador e execução interativa |
| Perfil motorista/empresa, edição e navegação em dispositivo | **NÃO VALIDADO** | Requer execução interativa |
| Status bar, navigation bar e telas críticas em dispositivo | **NÃO VALIDADO** | Requer execução interativa |
| Modo PRO e Modo MAX/GTO em dispositivo | **NÃO VALIDADO** | Requer Firebase, permissões nativas e execução interativa |

## Segurança contra regressão

O novo repositório não depende de APKs antigos, ZIPs de backup, branches históricas ou `dist` copiado manualmente. O build Web é regenerado pelo commit oficial; o Capacitor sincroniza os assets a partir desse `dist`; e os gates verificam que o Web embutido é coerente com o manifesto e com o runtime local.

O repositório histórico continua disponível para investigação, mas não é remoto da nova base. A branch `main` publicada contém somente a árvore oficial limpa. O `.gitignore` impede o retorno acidental de `dist`, builds, arquivos Capacitor gerados, credenciais Firebase, keystores e artefatos de release.

## Referências

[1]: https://github.com/doisd1399/NVU-PRO "Repositório privado NVU-PRO"

[2]: https://github.com/doisd1399/NVU-ZZZ-Android-/tree/2dc553ee5fdab1a93f8859ade3d3539aa484bc4e "Commit-fonte histórico confirmado pelo backup"

[3]: https://drive.google.com/drive/folders/1zd_6ztYTBuEoWzVJUDC3rXzelUoqvlhS "Pasta de backups oficiais fornecida pelo usuário"

[4]: https://drive.google.com/drive/folders/1IFZvgLNLG1ZcXnlQ-1AoIHpnoGmRl661 "Pasta privada de insumos de release fornecida pelo usuário"
