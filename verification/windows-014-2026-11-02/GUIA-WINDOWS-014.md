# NVU Windows 0.1.4 — atualização do assistente

Candidata: QA controlado aprovado. Cursor/foco e entregas no Windows com ETS2/ATS reais ainda precisam de aceite.

1. Feche ATS/ETS2 e saia da NVU antiga pela bandeja. Instale NVU-PRO-Windows-0.1.4-x64-Setup.exe.
2. Abra a NVU, entre com a conta habitual e vá a PRO → Simuladores. Atualize o plugin NVU em cada jogo utilizado e abra novamente o simulador. A DLL desta edição também é 0.1.4; a 0.1.2 anterior precisa ser substituída para fornecer a distância. Preserve os demais plugins.
3. Selecione a empresa/operação correta e ative ou retome o PRO.
4. Ctrl+N abre/oculta. Todas as ações usam mouse. Tab, setas, Enter, espaço e Esc não navegam no assistente. Os atalhos antigos foram removidos.
5. O assistente aberto recebe o mouse na área útil do monitor. Arraste o cabeçalho para mover somente o card. Clique no × ou use Ctrl+N para ocultar; clique fora não o fecha. Use Voltar ao ATS/ETS2 para tentar focar o jogo. Se o Windows impedir, use Alt+Tab.
6. Enquanto o painel estiver oculto, os avisos no topo continuam sem tomar foco ou capturar cliques. Prefira janela sem bordas. A tela cheia exclusiva pode impedir a sobreposição.
7. O sol/lua no cabeçalho altera o tema e sincroniza com a NVU. As ações não aparecem selecionadas só por receber foco.
8. Viagem atual fica fixa, mesmo com o histórico rolando. Distância restante vem do GPS SCS (metros → km); sem esse campo, mostra a distância planejada do frete. Sem ambos, exibe indisponível. A interface usa mi no ATS e km no ETS2, sem inferir a configuração de unidades do jogo. A distância canônica da entrega continua em km.
9. Ao identificar a entrega, a rota atual é removida antes da confirmação. O card da última viagem confirmada é identificado como encerrado. Um heartbeat residual não reabre aquela viagem; somente um novo UUID de frete válido cria novo acompanhamento.
10. Salvar localmente/enfileirar não significa confirmação. O progresso continua autoritativo no servidor. Pendências conservam o contexto original; não apague os dados locais para resolver uma pendência.

Desenvolvimento/build em Windows x64 (Node 24, JDK 21 no JAVA_HOME e PATH, CMake/Build Tools C++):

```powershell
npm ci
npm --prefix functions ci
npm run windows:setup
npm run qa:setup
npm run test:windows
npm run qa
npm run windows:installer
```

A DLL compilada acompanha o projeto. Para recompilar: npm run windows:plugin. Em Linux com CMake/MinGW x64 POSIX: NVU_WINDOWS_CROSS=1 npm run windows:plugin. Para desenvolver: npm run windows:dev. Builds Web e Android permanecem separados; esta entrega não inclui novo APK ou publicação de backend.

Instalador, aplicativo e DLL sem assinatura Authenticode. Confira o SHA-256 registrado no relatório. Não execute a NVU permanentemente como administrador e não desative as proteções do Windows.
