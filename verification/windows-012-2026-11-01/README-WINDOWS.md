# NVU PRO Windows 0.1.2 — atualização e validação

Estado: candidata. A bateria controlada passou; entrega real em ATS/ETS2 e entrada nativa Windows ainda exigem validação.

## Instalação e uso

1. Feche a NVU antiga pela bandeja e feche ATS/ETS2.
2. Extraia TODO o ZIP Portable e abra `NVU PRO.exe` dentro da pasta extraída, ou use o instalador 0.1.2. Ambos usam os dados existentes em `%APPDATA%\NVU PRO`.
3. Entre com a conta Google habitual. Abra PRO Windows e confirme a versão 0.1.2.
4. Localize o jogo correto e escolha **Atualizar plugin** (ou Instalar plugin). A DLL instalada no jogo precisa ser atualizada separadamente do aplicativo. Os demais plugins são preservados.
5. Selecione uma operação válida, ative PRO e abra novamente o simulador. Aceite o aviso de plugin SCS se apresentado. A indicação de conexão só aparece após um heartbeat autenticado.
6. O botão circular NVU inicia recolhido. Clique para abrir as ações e arraste para mover. Ctrl+Alt+N abre/recolhe; Ctrl+Alt+P abre o painel. Prefira janela sem bordas.
7. Se continuar sem conexão, abra Conexão e plugin → Ver diagnóstico/Copiar diagnóstico. O resumo distingue plugin ausente, antigo, reinício necessário, ausência de sinal e interrupção. Nenhum diagnóstico é enviado automaticamente.
8. Progresso aumenta somente após confirmação do servidor. Pausar ou encerrar PRO conserva pendências; a operação continua no fluxo NVU existente.

Não apague os dados locais para tentar resolver pendências. Instalador e DLL não têm assinatura Authenticode. A integração usa mecanismos oficiais, sem alteração dos executáveis dos jogos.

## Evidências e limites

`npm run qa`: 19/19 etapas; 27 testes Windows; 6 cenários da interface. APIs Windows/Steam e jogos são controlados nos ensaios. O arquivo `actions-validation.json` especifica a camada de cada ação. A execução inicial isolada da interface falhou na inicialização da fixture TypeScript (__name); a fixture foi corrigida e a bateria atual completa passou sem reduzir critérios.

As imagens do usuário comprovam abertura do programa, perfil e sobreposição sobre ATS na edição anterior, com conexão ausente. Não identificam a causa da falha. O host de build não dispõe de Windows/ETS2/ATS; conexão real, entrega, cancelamento, Alt+Tab, perda de rede, reinício, entregas consecutivas, foco, DPI, monitores e desempenho não foram marcados como aprovados.

O backend permanece o publicado na etapa anterior. A bateria atual usa exclusivamente `demo-nvu-v36-4-staging`, com handlers reais e dados fictícios, sem viagens de produção. Metadados históricos de publicação e configuração OAuth ficam nos diretórios anteriores, com suas datas e limites originais. 187 arquivos Android originais estão idênticos ao ZIP v36; não foi gerado APK.

## Desenvolvimento e geração

Na raiz, com Node 24, JDK 21 e os requisitos do QA instalados:

```bash
npm ci
npm --prefix functions ci
npm run windows:setup
npm run qa:setup
npm run windows:plugin
npm run test:windows
npm run qa
npm run windows:dev
npm run windows:installer
npm run windows:portable
```

O plugin requer Windows x64, Visual Studio Build Tools C++ e CMake. Fonte, CMake, SDK 1.16/API 1.01 e licença estão em `desktop/windows/plugin`. A DLL entregue foi compilada em host Linux com MinGW x64, runtime estático e apenas imports do sistema Windows; o comando e exports estão em `plugin-build.txt`. Builds Web, Android e Windows permanecem separados. Consulte também `desktop/windows/README.md`.

## Integridade

- NVU-PRO-Windows-0.1.2-x64-Setup.exe: `0af3ba87b50f22a41db62c031d49a9f99f9004135b1e794a239c44b541507275`
- NVU-PRO-Windows-0.1.2-x64-Portable.zip: `1317ef210cada8eebc6f9d4fbf3c40e52f1a29132f7f5963e625aa6bc3575e0e`
- NVU-PRO-Windows-0.1.2-Instalador.zip: `27a6665b4bf50f7987e0a79e67b41b36dc7c56c0966b078b3f7ae2c3ba4ad907`
