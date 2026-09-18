# Correção Android — centralização e clique fora do menu

## Causa raiz

A implementação continuava usando o `GlobalMenu.tsx` compartilhado, mas o contrato Android final definia `left: 50%` e simultaneamente `transform: none`. O card, portanto, começava no centro da viewport em vez de ter seu centro geométrico no centro da viewport. Além disso, uma regra histórica específica do perfil motorista definia o overlay como `opacity: 0`, `visibility: hidden`, `pointer-events: none` e com transição. Como o overlay é montado quando o menu está aberto, essas propriedades impediam que ele recebesse o toque fora do card.

## Correção aplicada

O `GlobalMenu` continua sendo a única fonte para Motorista e Empresa. As classes estruturais de drawer (`w-64`, `left-0`) agora são aplicadas apenas quando o contexto não é Android. No Android, a folha consolidada usa o mesmo contrato para os dois perfis:

```css
position: fixed;
left: 50%;
top: calc(var(--nvu-native-header-height) + 0.6rem);
width: min(88vw, 26rem);
max-width: 26rem;
margin: 0;
transform: translateX(-50%);
```

O `translateX(-50%)` é exclusivamente geométrico e estático; não existe transição, slide, fade, scale ou delay.

O overlay aberto agora possui `position: fixed`, `inset: 0`, `z-index: 60` e `pointer-events: auto`. O card usa `z-index: 70`, portanto o overlay fica atrás do menu. O fechamento é acionado por `onPointerDown={onClose}` e `onClick={onClose}`. O card é um irmão do overlay no DOM, não seu descendente, logo toques internos não propagam para o overlay. Quando fechado, o overlay não é montado porque o JSX continua condicionado a `open`.

## Estado e eventos

`isMobileMenuOpen` continua sendo o estado responsável pela abertura do card e pelo overlay. `isProfileMenuOpen` continua controlando apenas o submenu de ações/perfil dentro do card. O `onClose` do `GlobalMenu` fecha `isMobileMenuOpen`; não existe listener global de `pointerdown` que reabra esse estado. Os efeitos de rota continuam fechando o menu quando a rota muda.

## Validação

| Verificação | Resultado |
|---|---|
| `GlobalMenu` único para os dois perfis | PASS |
| `left: 50%` no card Android | PASS |
| `transform: translateX(-50%)` estático | PASS |
| `left: 0`/drawer lateral no markup Android | PASS — removido do contexto nativo |
| Overlay `position: fixed; inset: 0` | PASS |
| Overlay aberto com `pointer-events: auto` | PASS |
| Hierarquia overlay/card `60 < 70` | PASS |
| Overlay fechado fora do DOM | PASS |
| Animação de abertura/fechamento | PASS — nenhuma |
| Lint | PASS |
| Build Web | PASS |
| Sync Capacitor | PASS |
| Runtime local e paridade de assets | PASS |
| OTA | PASS |
| APK Release | PASS |
| Assinatura | PASS — alias `nvukey`, APK Signature Scheme v2 |

A execução de toques reais em Edge 50 ou outro dispositivo Android físico não está disponível neste ambiente. O APK foi compilado e validado estruturalmente para o Android WebView; a confirmação perceptual final em dispositivo deve ser feita instalando o artefato.

## APK

- Arquivo: `NVU-PRO-1.0.359-vc359-Release-signed.apk`
- SHA-256: `570cab217c06ec0667315d958e03884acaaaee9876f28e92aeccef9ab341a16d`
- Package: `com.nvu.operacional`
- Version: `1.0.359` / versionCode `359`
