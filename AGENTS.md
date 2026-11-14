# NVU — verificações obrigatórias

- Leia `qa/README.md` antes de alterar o processo de qualidade.
- Para mudanças no aplicativo ou no servidor, execute `npm run qa` e reporte os resultados da fonte atual.
- Antes de gerar/publicar um APK de release, execute `npm run qa:release` e `npm run qa:gate`. O Gradle e o script de release exigem o relatório completo e atual.
- `qa:quick` e `qa` não aprovam APK. Falha, timeout, etapa ausente, fonte modificada, relatório antigo ou Android indisponível bloqueiam a liberação.
- Use somente o projeto fictício `demo-nvu-v36-4-staging` nos testes. Não leia nem modifique dados de produção para montar fixtures.
- Não declare Google OAuth, Android instrumental, jogo GTO ou latência de produção validados por testes com transportes controlados ou por emuladores do Firebase.
- Registre separadamente as etapas executadas, falhas e limitações do ambiente. Preserve os comprovantes e diários reais do usuário.
- Não gere APK, não publique backend nem envie mensagens externas como consequência de criar/rodar testes. Essas ações seguem o escopo solicitado pelo usuário.
- Achados P0/P1 abertos em `qa/audit-blockers.json` bloqueiam aprovação/liberação de APK mesmo com testes funcionais aprovados. Não remova bloqueios para obter verde; registre evidências de correção antes de resolver cada achado.
