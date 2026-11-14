# NVU PRO Windows 0.1.1 — configuração OAuth e nova candidata

O proprietário forneceu um cliente OAuth Desktop (`installed`) do projeto `vtc-frota-log`, com o número do projeto Firebase da NVU e endpoints oficiais do Google. Os campos foram adaptados para `clientId` e `clientSecret` no arquivo consumido pela camada Windows. O original recebido foi preservado. Nenhum token de usuário ou credencial administrativa foi incluído na configuração.

A versão Windows foi atualizada de 0.1.0 para 0.1.1, com as mesmas versões de dependências. A base Web continua 2.3.198. A camada Android não foi modificada. O backend publicado na etapa anterior foi preservado.

Uma consulta autenticada e somente de leitura ao endpoint oficial `GET /admin/v2/projects/vtc-frota-log/defaultSupportedIdpConfigs/google.com` confirmou HTTP 200, provedor Google habilitado e cliente principal do mesmo projeto. O cliente Web e a configuração remota foram preservados. A consulta não valida a aceitação de um ID token Desktop ou a preservação do UID no login.

O QA da fonte atual passou nas 18 etapas, incluindo 14 testes Windows controlados e o escritor real de viagens ETS2/ATS no projeto fictício dos emuladores. O relatório e os logs estão em `qa-current`.

O conteúdo da aplicação empacotada foi comparado com a fonte: configuração OAuth igual ao cliente fornecido, versão 0.1.1, 12 arquivos de runtime, 150 arquivos Web e DLL do plugin. Asserções foram executadas sobre os bytes empacotados sem imprimir o segredo de cliente ou tokens. O checksum e a conferência PE/assinatura constam do relatório geral.

As evidências de 0.1.0 e da publicação do backend foram mantidas nos diretórios anteriores. A candidata 0.1.1 substitui o instalador anterior sem configuração de login.

## Validações ainda indisponíveis

- Execução do instalador no Windows real.
- Login Google pelo navegador do Windows, aceitação do token pelo Firebase e preservação da identidade existente.
- Renovação com armazenamento DPAPI e logout reais.
- Plugin e sobreposição durante uma entrega dentro de ETS2 e ATS.
- Matriz de rede, reinício, Alt+Tab, DPI, monitores e desempenho nos jogos.
- Assinatura Authenticode para distribuição pública.

A candidata é entregue para esses testes; não foi declarada pronta para produção.

## Primeiro uso

1. Instalar a versão 0.1.1 no Windows x64.
2. Abrir a NVU e entrar com a mesma conta Google já usada no aplicativo.
3. Conferir se o perfil, as empresas e a operação existentes aparecem.
4. Com o simulador fechado, abrir PRO Windows, localizar ETS2 ou ATS e instalar explicitamente o plugin.
5. Abrir o jogo, selecionar uma operação válida e ativar o PRO. Usar janela ou janela sem bordas durante a primeira validação.

Atalhos: Ctrl+Alt+N para mostrar/ocultar a sobreposição; Ctrl+Alt+P para o painel. Configurações antigas em `%APPDATA%\NVU PRO\google-oauth.json` e variáveis NVU_GOOGLE_DESKTOP_CLIENT_ID/SECRET têm prioridade sobre o arquivo desta edição.

Referências oficiais: https://developers.google.com/identity/protocols/oauth2/native-app e https://firebase.google.com/docs/auth/configure-oauth-rest-api
