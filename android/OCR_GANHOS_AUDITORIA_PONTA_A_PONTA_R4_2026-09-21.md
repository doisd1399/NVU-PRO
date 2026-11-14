# NVU Android — Auditoria ponta a ponta do Modo Print/OCR de ganhos — R4

Data: 2026-09-21
Base auditada: R3 / native 1.0.376 / web 2.3.147
Entrega corrigida: native 1.0.377 / web bundle R4 sobre o runtime compatível R3.34

## 1. Abertura do Modo Print

O fluxo de entrada estava condicionado por três estados assíncronos antes da pintura do formulário: identificação do simulador, carregamento de operação/contrato e carregamento da disponibilidade do modo Print. Isso podia exibir spinners antes do formulário e dava a impressão de atraso/travamento.

### Correção R4
- O shell do Modo Print deixa de aguardar disponibilidade remota para pintar.
- O Modo Print deixa de ser bloqueado visualmente enquanto operação/contrato terminam de carregar.
- O Modo Print deixa de ser bloqueado pela identificação tardia do simulador.
- A verificação de manutenção/disponibilidade continua ativa quando a informação estiver disponível; ela não bloqueia a primeira pintura.
- O envio continua protegido por validação de operação no momento do lançamento.

## 2. OCR GTO — causa técnica de latência

O pipeline anterior criava um worker Tesseract a cada imagem e executava muitas passagens sequenciais: crops threshold, crops raw, linhas numéricas e OCR amplo. Além de aumentar o tempo total, isso aumentava a quantidade de trabalho de canvas/WebView e podia degradar a responsividade do Android.

### Correção R4
A análise foi reorganizada para:
1. iniciar pelo conteúdo original (raw) das regiões mais informativas;
2. aceitar primeiro evidência contextual ligada a `Valor a receber`;
3. usar threshold somente como fallback quando o raw não produzir valor contextual;
4. usar OCR amplo como confirmação/diagnóstico e proteção contra anúncio/valor dobrado;
5. usar linhas numéricas dedicadas somente como último fallback;
6. emitir `onValueDetected` somente depois da decisão final.

Isso reduz o caminho normal de OCR e evita que um pré-processamento agressivo substitua uma leitura contextual correta da imagem original.

## 3. Valor monetário

Os valores continuam sendo tratados como centavos no núcleo nativo. A regressão `R$ 16.166,00` foi adicionada explicitamente para impedir inflação de 100x por separadores brasileiros. Também foi encontrada e corrigida uma inconsistência adicional: o parser nativo considerava `R$ 100,00` como piso implícito, rejeitando ganhos legítimos abaixo de R$ 100. O piso agora é R$ 0,01.

Casos cobertos:
- `R$ 16.166,00` -> `1616600` centavos;
- `R$ 1.234,56` -> `123456` centavos;
- `R$ 99,90` -> `9990` centavos;
- negativos rejeitados.

## 4. Integridade do lançamento

O fluxo mantém:
- bloqueio de valor dobrado/anúncio;
- hash/checagem de duplicidade do comprovante;
- valor detectado automaticamente em modo GTO;
- submissão nativa idempotente;
- gravação de `valorCents` e `valor` derivados do mesmo valor inteiro;
- validação autoritativa da operação antes do lançamento;
- proteção contra slot de viagem já ocupado;
- fallback de submissão quando a gravação nativa excede o limite.

## 5. Alterações

- `RecordTrip-DOvgqCMk.js`: entrada do Modo Print não bloqueia a primeira pintura por estados assíncronos; pipeline OCR GTO reorganizado para priorizar imagem original e reduzir passagens.
- `GtoResultOcrConsensusPolicyTest.java`: regressão para `16.166,00`.
- `GtoMoneyValueRegressionTest.java`: regressões de parsing monetário.
- `app/build.gradle`: versionCode `377`, versionName `1.0.377`.
- `nvu-build.json`: buildId R4, mantendo o runtimeRevision compatível exigido pelo módulo GTO.

## 6. Validação executada neste ambiente

- `node --check RecordTrip-DOvgqCMk.js`: PASS.
- Inspeção estática de fluxo Print/OCR/native submission: PASS.
- Build/test Gradle: NÃO EXECUTADO porque o Gradle Wrapper tentou baixar Gradle 8.14.3 de `services.gradle.org`, mas este ambiente não possui acesso de rede ao servidor.
- APK Release assinado: NÃO GERADO neste ambiente. O projeto não contém keystore de release e as variáveis `RELEASE_STORE_FILE`, `RELEASE_STORE_PASSWORD`, `RELEASE_KEY_ALIAS` e `RELEASE_KEY_PASSWORD` não estão disponíveis.

## 7. Segurança de assinatura

Não foi criada uma nova chave para assinar o APK. Isso é intencional: uma chave nova produziria um certificado diferente e não seria uma atualização compatível com a instalação/publicação anterior do NVU.

Para gerar o APK Release atual é necessário usar a mesma keystore/certificado de release já utilizado pelo aplicativo.
