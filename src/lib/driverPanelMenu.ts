/**
 * Escolher o perfil de motorista (ou trocar de empresa como motorista) sempre cai no menu do Painel do motorista,
 * mesmo com uma operação em andamento: o estado de navegação leva um carimbo novo e o painel volta para o menu.
 */
export function driverPanelMenuState() {
  return { profileTab: "dashboard", panelMenu: Date.now() };
}
