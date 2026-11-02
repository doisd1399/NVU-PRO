# NVU Windows 0.1.3 — assistente de viagem

Candidata: QA controlado aprovado. Aceite no Windows com ETS2/ATS reais ainda pendente.

1. Feche a NVU anterior pela bandeja. Instale a 0.1.3 ou extraia TODO o Portable e abra NVU PRO.exe dentro da pasta.
2. Entre com sua conta habitual, selecione empresa/operação e ative ou retome o PRO.
3. O plugin permanece exatamente na 0.1.2. Preserve o plugin já atualizado e conectado. Se antigo/ausente, feche o jogo, prepare o plugin em PRO → Simuladores e reabra o simulador.
4. Sem botão circular. Ctrl+Alt+N abre/oculta o assistente. Ele recebe foco e permanece aberto até uma ação explícita. Arraste o cabeçalho para mover e use as bordas para redimensionar.
5. Navegue por mouse, Tab/setas/Enter. Com cursor capturado, Ctrl+Alt+PageUp/PageDown selecionam e Ctrl+Alt+Enter executa. Esses três atalhos só ficam registrados com o assistente aberto. Esc oculta quando há foco. Ctrl+Alt+P abre a NVU.
6. Voltar ao ATS/ETS2 usa Win32 para focar o jogo. Se o Windows negar, use Alt+Tab. Prefira janela sem bordas; o simulador pode pausar ao perder foco.
7. Com painel oculto, os avisos no topo central ignoram cliques e não tomam foco. Captura/fila local não são apresentadas como registro confirmado.
8. A entrada PRO discreta no aplicativo abre ajustes por abas Viagem, Simuladores e Como usar. Tema acompanha a NVU. Diagnóstico fica recolhido na ajuda.

O histórico nativo mostra viagens acompanhadas neste computador. O link de histórico completo abre a operação filtrada na aplicação. Encerrar PRO exige confirmação, mantém a operação e conserva as pendências no contexto original. Não apague dados locais para tentar corrigir pendências.

Comandos na raiz (Node 24, JDK 21 e requisitos de qa/README.md):

```powershell
npm ci
npm --prefix functions ci
npm run windows:setup
npm run qa:setup
npm run test:windows
npm run qa
npm run windows:installer
npm run windows:portable
```

Para desenvolver: npm run windows:dev. Para recompilar o plugin: Build Tools C++/CMake no Windows e npm run windows:plugin. Esta revisão preserva a DLL 0.1.2 já compilada. Fonte, SDK oficial 1.16/API 1.01 e licença acompanham o projeto. Instalador por usuário, aplicativo e DLL sem assinatura Authenticode.
