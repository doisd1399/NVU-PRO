# NVU PRO — histórico de viagens no menu nativo

## Escopo

A implementação adiciona ao card/menu flutuante nativo do Modo Pro um histórico compacto das viagens confirmadas na operação corrente. O histórico é uma projeção local deduplicada; o documento em `historico_viagens` continua sendo a fonte autoritativa.

## Alterações

O menu nativo agora possui um botão compacto de histórico disponível em todas as etapas que têm uma operação ativa. O painel exibe origem, destino e valor de cada viagem confirmada, em ordem cronológica. A projeção é limitada ao escopo de `jobId`, empresa e motorista atuais; ao trocar o escopo da operação, a projeção anterior é descartada.

O histórico só é atualizado depois que a gravação Firestore é confirmada. O caminho nativo registra o item imediatamente após `set()` confirmado e o caminho Web fallback usa a ponte Capacitor após o retorno de confirmação. O `tripId` é a chave de idempotência local, portanto retries e reprocessamentos não duplicam o item. Depois da confirmação, o bubble mostra um preview da viagem mais recente.

O menu nativo deixou de usar `FLAG_NOT_TOUCH_MODAL`; o `ACTION_OUTSIDE` é consumido integralmente e fecha o menu sem propagar o toque para o simulador. O overlay Web também usa `preventDefault` e `stopPropagation` no toque fora.

## Evidências

| Verificação | Resultado |
|---|---|
| Contrato estrutural de histórico/touch | PASS |
| TypeScript e lint | PASS |
| Regressões OCR/Print | PASS |
| Registro nativo imediato e snapshot | PASS |
| Build Web/Capacitor e gates de assets/OTA | PASS |
| APK Release assinado | PASS — assinatura v2 |
| Identidade Android | PASS — `com.nvu.operacional`, `versionCode 359`, `versionName 1.0.359` |
| SHA-256 do APK | `c24d7e1e15ede431cfc1e672358d069eb83b84fccb7cb1fc7c35130cd2b705da` |

Não foi possível executar interação manual em dispositivo/emulador Android nesta sessão; a validação de UI foi feita por contratos estruturais e pela compilação/inspeção do APK.

## Artefatos fora do Git

O APK e o ZIP do código Android são mantidos na área de releases local, fora do repositório, juntamente com os insumos privados de assinatura. Nenhuma credencial, APK ou diretório gerado é versionado.
