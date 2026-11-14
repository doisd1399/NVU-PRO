# NVU PRO 1.0.520 / Web 2.3.197

Esta é a versão atual deste projeto. Consulte [LEIA-ME-1.0.520.md](LEIA-ME-1.0.520.md) para alterações, publicação, testes e recompilação.

- Backend de registro atualizado no Firebase.
- Dist pronta para Netlify no ZIP separado.
- APK assinado no arquivo separado; instalar como atualização, sem limpar dados.
- Os relatórios atuais ficam em `reports/release-520/`.
- Guias e verificadores de versões anteriores são históricos.

## Processo automatizado de qualidade

Consulte [qa/README.md](qa/README.md). Execute `npm run qa` para Web/Firebase e `npm run qa:release` para incluir o Android. O release agora exige aprovação atual da fonte. O aplicativo continua na versão 1.0.520; esta revisão acrescenta infraestrutura de testes.
