# Roteiro de teste nos jogos (ETS2 e ATS) — cerca de 20 minutos por jogo

Objetivo: provar no jogo real o que os testes automáticos só provam com simulação. Faça uma vez com o **ETS2** e repita com o **ATS**. Marque cada item com ✔ ou ✘. Se algum falhar, siga o último passo ("O que me mandar").

Antes de começar: instale a NVU 0.2.x (`Verificar-NVU.ps1` deve mostrar `OK`), abra pelo atalho **NVU PRO**, entre com a conta Google e tenha uma operação com você como motorista designado.

| # | Faça | Esperado |
|---|---|---|
| 1 | Feche o jogo. Na NVU: **PRO → Simuladores → Preparar simulador**. | Etapas ficam verdes até "Instalado, aguardando reinício do jogo". Versões: **Esperada = Instalada = 0.2.0**; Carregada vazia. Se o Windows pedir permissão de administrador, aceite. |
| 2 | Abra o jogo, aceite o aviso de plugin da SCS (se vier) e carregue o perfil até poder dirigir. | NVU mostra **Carregada pelo jogo = 0.2.0** e **Conectado**. |
| 3 | Na NVU, **Ativar PRO** na operação. No jogo, pegue um frete pelo mercado de fretes. | O painel mostra a origem e o destino **do frete real** e a distância restante, sem rolagem. |
| 4 | Pause o jogo (Esc). | NVU mostra **pausado** (estado válido, não é falha). |
| 5 | Alt+Tab para outro programa e volte; depois feche e reabra a NVU com o jogo rodando. | Reconecta sozinha, sem duplicar a viagem. |
| 6 | Entregue o frete. | Primeiro "Confirmando…"; só depois **"Viagem registrada na NVU"** (após o servidor confirmar). O painel volta a "aguardando próximo frete" **sem origem/destino antigos**. |
| 7 | Pegue outro frete e **cancele-o** no jogo. | A NVU não registra entrega e limpa a rota. |
| 8 | Desligue a internet, entregue um frete, feche a NVU, reabra, religue a internet. | A viagem pendente é preservada e enviada ao voltar a rede; nada duplicado. |
| 9 | **Ctrl+N** abre e oculta o assistente; use só o mouse; ao ocultar, o teclado e o mouse voltam ao jogo. | Nenhum botão vem selecionado; o card não fecha sozinho. |
| 10 | No Histórico da NVU, olhe a viagem entregue. | Mostra "ETS2" ou "ATS" (nunca um código interno) e valor/moeda corretos (EUR no ETS2, USD no ATS). |

## O que me mandar se algo falhar

- Em **PRO → Simuladores → Ajuda com a conexão e diagnóstico → Diagnóstico de inicialização**: o texto copiado (não tem dados pessoais).
- Uma captura de tela do passo que falhou e o número do passo.
- A versão do jogo (aparece no diagnóstico como `gameVersion`) e se o Steam está em outra biblioteca/disco.
