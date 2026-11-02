// Stable error codes shown to the user and written to the diagnostic log. Each code has a plain-language title and the
// next action the person can take. Codes never change meaning; add new ones instead.
const CATALOG = Object.freeze({
  'NVU-S010': ['Sistema não suportado', 'A NVU Windows exige Windows 10 ou 11 de 64 bits.'],
  'NVU-S020': ['Pasta de dados da NVU sem acesso', 'Confirme que sua conta do Windows pode gravar em %APPDATA%\\NVU PRO. Não apague a pasta: ela guarda suas viagens pendentes.'],
  'NVU-S030': ['Registro de diagnóstico indisponível', 'A NVU continua funcionando, mas não conseguirá gravar o registro técnico. Verifique espaço em disco e permissões de %APPDATA%\\NVU PRO\\logs.'],
  'NVU-S040': ['Pasta de comunicação com o plugin indisponível', 'Verifique se %LOCALAPPDATA%\\NVU está acessível à sua conta e se nenhum programa de segurança o bloqueia.'],
  'NVU-S041': ['Permissões da pasta de comunicação não puderam ser protegidas', 'Abra a NVU com a mesma conta do Windows usada para jogar. Se um antivírus bloqueia o icacls.exe ou o whoami.exe, libere somente esses programas do Windows.'],
  'NVU-S042': ['Chave local da comunicação com o plugin inválida', 'A NVU recria a chave automaticamente; se o erro persistir, feche o jogo e abra a NVU novamente.'],
  'NVU-S050': ['Diário local de viagens ilegível', 'Nada foi apagado: uma cópia do arquivo foi preservada ao lado dele. Envie o diagnóstico ao suporte antes de qualquer outra ação.'],
  'NVU-S060': ['Plugin empacotado ausente ou diferente do esperado', 'Reinstale a NVU com o instalador completo. Não copie arquivos manualmente.'],
  'NVU-S070': ['Configuração do login Google inválida', 'O restante da NVU abre, mas o login Windows depende da configuração do administrador (cliente OAuth Desktop).'],
  'NVU-S080': ['Arquivos da interface da NVU ausentes ou incompletos', 'Reinstale a NVU com o instalador completo. O instalador preserva suas configurações e viagens.'],
  'NVU-S081': ['Política de segurança da interface não pôde ser montada', 'Reinstale a NVU com o instalador completo.'],
  'NVU-S090': ['A janela principal não abriu', 'Feche a NVU pela bandeja e abra novamente. Se persistir, envie o diagnóstico ao suporte.'],
  'NVU-S100': ['Ícone da bandeja indisponível', 'A NVU continua funcionando; use o atalho do Menu Iniciar para reabrir a janela.'],
  'NVU-S101': ['Atalho Ctrl+N ocupado por outro programa', 'Use "Abrir assistente no jogo" na janela da NVU ou libere o atalho no outro programa.'],
  'NVU-S110': ['Configuração local de jogos ilegível', 'A NVU recria a lista de jogos; localize novamente os simuladores em Preparar simulador.'],
  'NVU-S999': ['Falha inesperada na inicialização', 'Copie o diagnóstico e envie ao suporte.'],
  'NVU-I010': ['A NVU já estava aberta', 'A janela existente foi trazida para frente.'],
  'NVU-I020': ['Outra versão da NVU está em execução', 'Feche a versão anterior pela bandeja do Windows (ícone da NVU perto do relógio → Sair da NVU) e abra novamente, ou escolha trocar de versão.'],
  'NVU-I030': ['Já existe uma NVU em execução', 'Feche-a pela bandeja do Windows (ícone da NVU perto do relógio → Sair da NVU) e abra novamente.'],
  'NVU-I040': ['Não foi possível assumir o lugar da versão anterior', 'Feche a NVU anterior pela bandeja do Windows ou pelo Gerenciador de Tarefas (somente "NVU PRO") e abra novamente.'],
  'NVU-P010': ['Simulador não localizado', 'Escolha a pasta do jogo (a que contém bin\\win_x64) em Preparar simulador.'],
  'NVU-P020': ['O simulador está aberto', 'Feche o ETS2/ATS e tente novamente. A preparação continua automaticamente quando o jogo fechar.'],
  'NVU-P030': ['Já existe um plugin com o mesmo nome que não é da NVU', 'A NVU não substitui arquivos de terceiros. Renomeie ou remova o arquivo indicado e tente novamente.'],
  'NVU-P040': ['Destino do plugin redirecionado', 'A pasta de plugins do jogo aponta para outro lugar (atalho/junção). Escolha uma instalação normal do jogo.'],
  'NVU-P050': ['Sem permissão para gravar na pasta do jogo', 'A NVU pode pedir uma confirmação do Windows (administrador) somente para copiar o plugin. Aplicativo e jogo continuam com permissões normais.'],
  'NVU-P051': ['Permissão de administrador não concedida', 'Sem a confirmação do Windows o plugin não pode ser gravado nessa pasta. Tente novamente e aceite, ou mova a biblioteca do jogo para uma pasta do seu usuário.'],
  'NVU-P052': ['A operação com permissão elevada falhou', 'Tente novamente. Se persistir, copie o diagnóstico e envie ao suporte.'],
  'NVU-P060': ['Plugin empacotado inválido', 'Reinstale a NVU com o instalador completo.'],
  'NVU-P070': ['O plugin não pôde ser gravado', 'Verifique espaço em disco e se o antivírus não bloqueou a pasta do jogo.'],
  'NVU-P080': ['O arquivo gravado não confere com o plugin esperado', 'Nada foi marcado como preparado. Tente novamente.'],
  'NVU-P090': ['O jogo não carregou o plugin esperado', 'Feche e abra o simulador novamente e aceite o aviso de plugin da SCS, se aparecer.'],
});
class NvuError extends Error {
  constructor(code, detail = '', { cause, details, fatal = true } = {}) {
    super(detail || (CATALOG[code] || CATALOG['NVU-S999'])[0]);
    this.name = 'NvuError'; this.code = CATALOG[code] ? code : 'NVU-S999'; this.fatal = fatal; this.details = details; if (cause) this.cause = cause;
  }
}
const describe = code => { const [title, action] = CATALOG[code] || CATALOG['NVU-S999']; return { code: CATALOG[code] ? code : 'NVU-S999', title, action }; };
module.exports = { CATALOG, NvuError, describe };
