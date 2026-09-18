# NVU PRO

**NVU ANDROID OFFICIAL BASELINE**: nova fonte oficial, limpa e reproduzível do NVU Android.

## Origem e identidade

A base de código foi reconstruída a partir do projeto-fonte completo fornecido no backup oficial `NVU-Pro-v1.2-full-project-backup.zip`. O snapshot foi identificado como o commit `2dc553ee5fdab1a93f8859ade3d3539aa484bc4e` do repositório histórico `doisd1399/NVU-ZZZ-Android-`. O APK Golden de referência é o `NVU-Pro-v1.2-R3.34-PC-HF60-Android-1.0.358.apk`, cujo SHA-256 é `a77efea8849c1bdc950366d7ddb1370e155a6112f7ed83bca1767a8fec635a65`.

A baseline Web permanece na versão `2.3.141`, com runtime `R3.34-PC-WEB-AUTH-ARCHITECTURE-MODULAR`. A nova identidade nativa destinada à próxima release é `versionName 1.0.359` e `versionCode 359`; a alteração é somente de identidade de release, não uma substituição do código funcional pela árvore histórica.

## Arquitetura

O Android carrega o Web empacotado localmente:

```text
src + public
  -> npm run build
  -> dist
  -> npx cap sync android
  -> android/app/src/main/assets/public
  -> Gradle assembleRelease
  -> APK Release assinado
```

`capacitor.config.ts` não define `server.url` e usa `webDir: "dist"`. O runtime remoto/OTA é legado e permanece **desabilitado por padrão**. Qualquer habilitação futura deve ser explícita, com URL de manifesto HTTPS, chave pública correspondente e validação do canal `production-<versionCode>`; a chave privada nunca pertence ao repositório.

## Instalação

Requisitos: Node.js 22 ou superior, npm 10 ou superior, JDK compatível com Java 21, Android SDK configurado e credenciais privadas de build mantidas fora do Git.

```bash
npm ci
```

## Build Web e sincronização Capacitor

```bash
npm run build
npx cap sync android
npm run prepare:cap-assets
npm run verify:cap-local
npm run verify:cap-assets
```

O último gate confirma que o fallback Web embutido é um espelho SHA-256 do `dist`, que o runtime é local e que o modelo OCR não está duplicado no APK.

## APK Release assinado

O `android/` é a plataforma Capacitor do repositório. O projeto exige `google-services.json` para o fluxo Release porque o login nativo Firebase faz parte da aplicação. Esse arquivo é secreto/privado e deve ser fornecido localmente em `android/app/google-services.json`; ele não é versionado.

O keystore também deve ficar fora do Git. O Gradle lê as seguintes propriedades de ambiente ou propriedades Gradle:

```text
RELEASE_STORE_FILE
RELEASE_STORE_PASSWORD
RELEASE_KEY_ALIAS
RELEASE_KEY_PASSWORD
```

Com esses insumos configurados:

```bash
cd android
./gradlew clean assembleRelease
cd ..
mkdir -p release
cp android/app/build/outputs/apk/release/app-release.apk \
  release/NVU-PRO-1.0.359-vc359-Release-signed.apk
sha256sum release/NVU-PRO-1.0.359-vc359-Release-signed.apk
```

O APK recém-gerado deve ser verificado com `apksigner verify --verbose`, além de validar package/applicationId, assinatura, `versionName`, `versionCode`, existência de `assets/public/index.html` e ausência de dependência de `server.url`/Netlify para o carregamento inicial.

## Testes e validação

Os gates locais disponíveis são:

```bash
npm run verify:cap-local
npm run verify:cap-assets
npm run lint
```

Os testes de login, Firebase, perfis, Modo PRO, Modo MAX/GTO, captura, seleção/validação de frete, status bar e navegação devem ser executados em ambiente com Firebase configurado e, quando necessário, dispositivo/emulador Android. Um teste não executado não deve ser reportado como PASS.

## Release e tag

A tag oficial deve ser criada somente depois de um APK Release assinado ser compilado e validado. O nome recomendado é `v1.0.359-release`. O commit da tag deve ser exatamente o commit utilizado na geração do APK validado.

## Segurança

Não versionar `google-services.json`, `.env`, keystores, senhas, chaves privadas OTA, APKs antigos, AABs, ZIPs de backup, `dist` manual ou builds de teste. Os backups originais e o repositório histórico permanecem preservados fora desta árvore como fontes forenses.

## Estado da baseline

A árvore foi auditada e o build Web/Capacitor local foi executado com sucesso. A compilação Android Release assinada permanece pendente até que sejam fornecidos, no ambiente de build, `google-services.json` e as credenciais do keystore; nenhuma senha foi adivinhada e nenhum segredo foi gravado no Git.
