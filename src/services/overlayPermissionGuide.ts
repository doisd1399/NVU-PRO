/** Shown only after Android reports that the Pro overlay permission is missing. */
export function explainOverlayPermissionBeforeSettings(): void {
  window.alert(
    "Para mostrar o botão do Modo Pro sobre o simulador, autorize a sobreposição da NVU na próxima tela.\n\n" +
    "Se o Android impedir a ativação: volte, abra Configurar > Apps > NVU > menu ⋮ > Permitir configurações restritas. " +
    "Confirme com a senha ou biometria. Depois abra novamente Sobrepor a outros apps > NVU e ative a opção.\n\n" +
    "Volte à NVU e toque em Iniciar trabalho. Essa confirmação é exigida pelo Android para algumas instalações por APK."
  );
}
