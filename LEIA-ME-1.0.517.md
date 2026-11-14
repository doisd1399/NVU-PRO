# NVU PRO 1.0.517 — candidata para diagnóstico do modo print

Esta versão corrige os defeitos de temporização reproduzidos na 516 e acrescenta um diagnóstico exportável para identificar a exceção que permanece no Moto Edge 50 com Android 16. A causa específica da ocorrência no telefone ainda depende desse diagnóstico.

## Instalação e teste no aparelho

1. Instale `NVU-PRO-1.0.517-DIAGNOSTICO.apk` sobre o aplicativo existente. Não desinstale nem limpe os dados. O pacote é `com.nvu.operacional`, versionCode 517, assinado com o certificado original.
2. Abra a mesma conta e operação e tente lançar uma viagem pelo modo print.
3. Se falhar, na tela de lançamento, próximo ao botão LANÇAR VIAGEM, use **Copiar diagnóstico** ou **Compartilhar diagnóstico** e envie o texto nesta conversa. O botão de compartilhamento abre o seletor do Android; nada é enviado automaticamente.
4. Se funcionar, confira que há uma única viagem no histórico, que ela chega ao estado Enviada e que o progresso aumenta somente uma vez. Feche e reabra o app e confira a mesma viagem.

O diagnóstico nativo guarda apenas o último relatório, associado à conta que o gerou. Ele fica separado do localStorage e reaparece ao abrir a tela de lançamento com essa conta. Se até o armazenamento nativo falhar, o relatório permanece disponível na tela durante a sessão; copie-o antes de fechar. O painel identifica o **último erro**, não o estado atual de todas as viagens.

## Alterações

- O timer de abertura IndexedDB é cancelado assim que o banco abre.
- Um timeout do mutex após a gravação síncrona bem-sucedida retorna o resultado já gravado.
- Callbacks tardios não gravam após cancelamento.
- Erros da gravação continuam sendo erros e não provocam nova execução do trabalho.
- O timer de Web Locks é liberado em todos os caminhos.
- Diagnóstico registra a subetapa, cadeia de erros sanitizada, duração total, versão Android/WebView/app, build web e existência da tentativa no journal.
- O relatório não inclui o objeto da viagem, print, conteúdo da fila, tokens ou credenciais de assinatura. As mensagens/stack passam por remoção de URLs, emails e padrões de credenciais.
- O diagnóstico é copiado/compartilhado somente por ação do usuário. Nenhum upload automático de diagnóstico foi introduzido.

## Evidências

Consulte `reports/release-517/`: os relatórios desta versão estão separados dos resultados históricos da 516. `apk-verification.json` vincula os marcadores e testes nativos ao hash do APK.

Os testes de navegador usam interface e persistência reais, OCR, Auth/Firestore/Storage locais e dados de sessão/empresa de QA. Não substituem o teste do APK no Moto. Os testes unitários nativos existentes não validam por si mesmos a execução do novo plugin no dispositivo.

## Reprodução do build no Windows

Requisitos: Node 22+, Java 21, Android SDK 36. Forneça o `google-services.json` original em `android/app/`, a keystore original fora do pacote e as variáveis `RELEASE_STORE_FILE`, `RELEASE_STORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD`, `JAVA_HOME`, `ANDROID_HOME`. As senhas não fazem parte desta entrega. Configure `android/local.properties` para seu SDK.

```powershell
npm.cmd ci
npm.cmd --prefix functions ci
npm.cmd run lint
npm.cmd run test:print-diagnostic-517
npm.cmd run test:print-local-516
node --import tsx scripts/test-local-commit-515.ts
npm.cmd --prefix functions run build
npm.cmd run build
npx.cmd --no-install cap sync android
npm.cmd run prepare:cap-assets
npm.cmd run verify:cap-assets
npm.cmd run verify:cap-local
.\android\gradlew.bat -p android clean testReleaseUnitTest assembleRelease --no-daemon --console plain
```

Para testar a interface/rede: execute `scripts/test-recordtrip-ui-517.mts` e `scripts/test-print-network-e2e-517.mts` sob `firebase emulators:exec`, projeto **demo-nvu-v36-4-staging**, emuladores **firestore,storage,auth**, com `scripts/guard-loopback-network.mjs` pré-carregado nos processos de teste. Defina `PLAYWRIGHT_CHROMIUM_EXECUTABLE` se usar um navegador instalado. Proxy do ambiente pode interferir na conexão local; ajuste apenas o processo de teste.

Os scripts antigos `verify:release-516` e `verify:source-516` são evidência histórica e podem exigir o manifesto da 516. Use os comandos acima para esta candidata; não reaproveite certificados de validação antigos como resultado da 517.

Nenhuma função ou regra Firebase foi publicada nesta rodada. A candidata usa o mesmo projeto e backend que a 516.
