# NVU PRO — projeto com patch ETS2/ATS ônibus

Código-fonte completo preparado para edição na branch `projeto-1.0.597-modo-pro-audios` do repositório `doisd1399/NVU-PRO`.

## Estado desta entrega

- Base: versão Android **1.0.596 / versionCode 596**, Web **2.3.253**, com os áudios originais do Modo Pro restaurados.
- O patch de OCR do resumo de viagem de ônibus foi aplicado. A atualização de versão para Android 1.0.597 e Web 2.3.254 permanece pendente da validação.
- A versão **1.0.597 ainda não é uma release aprovada**. Nenhum APK novo é apresentado como validado.
- Verificação de 14/11/2026: instalação das dependências concluída; TypeScript aprovado; parser `SCS_SUMMARY_WORDS_PASS 6/6`; OCR real da imagem bloqueado pela indisponibilidade do Chromium. A sequência de validação foi interrompida nessa etapa.
- `npm run qa`, `npm run qa:release` e `npm run qa:gate` precisam de execução integral e atual antes de gerar o APK.

## Abrir e executar

Use Node.js 22 ou superior e npm. Na raiz do projeto:

```bash
npm ci
npm --prefix functions ci
npm run dev
```

A configuração privada do Firebase deve ser fornecida pelo proprietário em ambiente local. Credenciais, contas de serviço, arquivos `.env*`, `google-services.json` real e materiais de assinatura não fazem parte deste repositório. Configure-os fora do controle de versão. Não substitua a configuração por dados inventados.

Para preparar e validar a aplicação:

```bash
npm run qa:setup
npx tsc --noEmit -p .
node --import tsx scripts/test-scs-summary-words.mjs
node scripts/test-scs-bus-ocr.mjs
npm run qa
```

O setup reconstrói os recursos locais de OCR e imagens a partir das dependências e do modelo de idioma comprimido incluído no projeto. A leitura real de OCR exige Chromium funcional. Leia `AGENTS.md` e `qa/README.md` para os requisitos completos. Os testes usam somente o projeto fictício `demo-nvu-v36-4-staging`.

## Android

O processo exige JDK 21, Android SDK 36, Build Tools 35 e Android/AVD conectado para a instrumentação. Com a configuração privada de assinatura disponível e todas as pendências resolvidas:

```bash
npm run qa:release
npm run qa:gate
```

Gere o APK somente após os dois comandos aprovarem a fonte atual. Não reutilize relatórios antigos, não contorne o gate e não trate indisponibilidade como aprovação. O envio desta branch não inicia publicação nem build automático de release.

## Escopo do patch

O único arquivo de implementação do aplicativo alterado pelo patch é `src/services/scsTripOcrService.ts`. Também foram adicionados `LEIAME-PATCH.txt`, `qa-config-trecho.json`, dois testes e dois fixtures; `qa/config.json` recebeu os passos correspondentes.

O OCR da base tinha SHA-256 `ea45d4b221f14036f5604e46f30a5ecc0a64e91c515c66d3a026c5631359a80a`. Após o patch, o SHA-256 é `5eeeab469e0a6416ffd76e69674f11e998056eec8c30ba099e374dcef37c855a`.

A revisão estática identificou pendências nas regras exigidas: há aceitação de km sem três votos, a votação pode aceitar somente uma posição e o Total pode ser aceito sem linhas de dinheiro quando a confiança é alta. Essas divergências não foram alteradas nesta importação e precisam ser resolvidas antes de declarar conformidade com as regras solicitadas.

## Arquivos excluídos do Git

O `.gitignore` exclui credenciais e chaves, dependências instaladas, caches, resultados de QA, saídas Web/Android/Functions, arquivos sincronizados do Capacitor e pacotes de entrega (`.apk`, `.aab`, `.exe`, `.zip`). Os áudios e as imagens necessários ao projeto permanecem na fonte. Nenhum arquivo desta importação excede 50 MB.

Os relatórios existentes em `verification/` registram verificações históricas. Eles não aprovam esta fonte nem substituem uma nova execução completa.
