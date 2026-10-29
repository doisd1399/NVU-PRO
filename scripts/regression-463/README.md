# NVU 1.0.463 RC1 — como reproduzir os testes offline

Pré-requisitos para o subconjunto executado: Node.js 22+, Python 3, Java/JDK 17+ (javac). Os testes não acessam o Firebase.

```bash
node --import ./scripts/regression-463/register.mjs scripts/regression-463/regression-runtime.mjs "$(pwd)"
python3 scripts/regression-463/run-java.py
node scripts/test-pro-pending-queue-contract.mjs
node scripts/test-operation-close-pending-guard.mjs
node scripts/test-ranking-photo-r4-contract.mjs
```

O verificador sintático `verify-typescript-syntax.cjs` usa um caminho de TypeScript do ambiente de auditoria; em outra máquina substitua o require pelo seu TypeScript local. Ele só detecta sintaxe, **não** executa `tsc --noEmit`.

Para um APK instalável, antes instale dependências com `npm ci`, execute `npm run lint`, `npm run build`, sincronize Capacitor (`npx cap copy android`), compile Android, teste num aparelho e assine com **a chave original** do aplicativo. Sem isso, este pacote é somente uma candidata de **código-fonte**, não uma candidata APK. Não executar `firebase deploy`.
