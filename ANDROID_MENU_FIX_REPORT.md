# Correção Android — menus flutuantes de Perfil

## Diagnóstico

Os menus de Perfil da Empresa e Perfil do Motorista são renderizados pelo mesmo componente `src/components/GlobalMenu.tsx`. Os layouts `AdminLayout` e `DriverLayout` fornecem apenas o perfil, os dados de conteúdo e os handlers; o comportamento de abertura, fechamento e clique fora permanece compartilhado.

A diferença visual não era causada por duas implementações funcionais distintas, mas pela cascata CSS histórica. O menu Empresa recebia regras adicionais por `.nvu-admin-sidebar`, `.nvu-admin-menu-*` e blocos HF posteriores, enquanto o Motorista recebia regras equivalentes por `.nvu-native-sidebar` e `.nvu-profile-menu-*`. Essas regras repetiam e sobrescreviam largura, altura, padding, border-radius, overflow, posição e estado visual em vários pontos de `src/index.css`. Em consequência, a regra efetiva dependia da ordem final da folha e de combinações diferentes de classes Tailwind.

A animação tinha duas origens simultâneas. O `GlobalMenu` aplicava `transition-transform duration-300 ease-in-out`, `translate-x-0` e `-translate-x-full` no próprio elemento. A folha Android também aplicava `transform`, `scale`, `translate`, `opacity`, `visibility`, `pointer-events` e transições em múltiplos blocos históricos. Havia ainda transições e transformações de interação em itens e ações do menu. O clique fora já era funcional por meio do overlay e foi preservado.

## Correção

A implementação continua usando um único `GlobalMenu`; nenhum menu paralelo foi criado e nenhuma opção funcional foi removida. Foi adicionado o sinal `nativeAndroid` aos usos de Empresa e Motorista. No Android, as classes Tailwind de movimento não são mais aplicadas ao menu, aos controles de perfil, aos links e às ações. No Web/Desktop, as transições existentes não relacionadas ao Android continuam disponíveis.

O estado Android passou a ser binário e explícito por `data-nvu-menu-open`:

| Estado | Renderização | Interação |
|---|---|---|
| Fechado | `display: none`, sem ocupação visual | Sem pointer events |
| Aberto | `display: flex`, container visível | Pointer events ativos |

A geometria Android agora é única para `[data-nvu-unified-profile-menu]`, independentemente de `profile="driver"` ou `profile="company"`:

| Propriedade | Motorista | Empresa |
|---|---:|---:|
| Largura | `min(88vw, 26rem)` | `min(88vw, 26rem)` |
| Max-width | `26rem` | `26rem` |
| Posição | centralizada, topo do header + `0.6rem` | igual |
| Padding estrutural | `0.72rem` | `0.72rem` |
| Border-radius | `1.28rem` | `1.28rem` |
| Altura | automática | automática |
| Max-height | viewport disponível | viewport disponível |
| Overflow | vertical com rolagem | vertical com rolagem |
| Sombra/borda | tokens Android compartilhados | tokens Android compartilhados |
| Animação | nenhuma | nenhuma |
| Abertura/fechamento | instantâneo | instantâneo |

As regras históricas conflitantes de movimento e dimensão dos seletores do menu foram removidas de forma controlada. As regras de conteúdo, cores, tema claro/escuro, acessibilidade, navegação, overlay e handlers foram preservadas.

## Validação automatizada

| Verificação | Resultado |
|---|---|
| Auditoria de componente compartilhado | PASS — `GlobalMenu` único para Empresa e Motorista |
| Auditoria de classes de movimento no CSS do menu | PASS — nenhuma regra residual de transform/transition/opacity/visibility nos seletores do menu |
| Lint | PASS |
| Build Web | PASS |
| Sync Capacitor | PASS — quatro plugins Android sincronizados |
| Verificação runtime local | PASS |
| Verificação de paridade dos assets | PASS |
| Verificação OTA | PASS — runtime local, canal `production-359` |
| Package Android | PASS — `com.nvu.operacional` |
| Versionamento | PASS — `versionName 1.0.359`, `versionCode 359` |
| Assinatura APK | PASS — APK Signature Scheme v2 |
| Certificado | PASS — corresponde ao alias `nvukey` |
| Manifesto Web embutido | PASS — versão `2.3.141`, runtime local, OTA desabilitada |
| Configuração Capacitor embutida | PASS — sem URL remota de servidor |

A validação em dispositivo físico/emulador não está disponível neste ambiente; portanto, testes perceptuais de toque, telas Android específicas e comparação visual pixel a pixel permanecem pendentes de execução em um dispositivo.

## APK gerado

O APK corrigido foi gerado a partir desta árvore com o mesmo `versionName/versionCode` da baseline:

- Arquivo: `NVU-PRO-1.0.359-vc359-Release-signed.apk`
- SHA-256: `57d5684f23280485e222a5a320cc8e771ccb32861921d5b5f4cd6450c21acdce`
- Assinatura: alias `nvukey`
- Certificado SHA-256: `806a03ea92b69e7f9a70526e9c4d6a4ae52ec4f9cf7cac05ddb1aa28084246ea`

## Arquivos alterados

- `src/components/GlobalMenu.tsx`
- `src/layouts/DriverLayout.tsx`
- `src/layouts/AdminLayout.tsx`
- `src/index.css`
- `ANDROID_MENU_FIX_REPORT.md`

Nenhuma alteração foi feita em autenticação, Firebase, banco de dados, permissões, modos PRO/MAX, GTO, observador, captura, viagens, ranking, histórico, contratos, veículos, APIs, sincronização ou notificações.
