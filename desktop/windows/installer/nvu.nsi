; NVU PRO Windows — instalador por usuário (sem administrador).
; Compilado por build-installer.cjs, que passa: -DVERSION -DVERSION4 -DOUTFILE -DUNPACKED -DICON -DFILES_NSH
; Princípios: nunca apaga dados do usuário sem pedir; nunca encerra processos de outros programas (só o NVU PRO.exe
; desta pasta, identificado pelo caminho completo da imagem); atualiza a instalação anterior no mesmo lugar.
Unicode true
ManifestDPIAware true
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 64
CRCCheck force
Name "NVU PRO"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\NVU PRO"
InstallDirRegKey HKCU "Software\NVU\Windows" "InstallDir"
BrandingText "NVU PRO Windows ${VERSION}"
ShowInstDetails show
ShowUnInstDetails show

VIProductVersion "${VERSION4}"
VIAddVersionKey /LANG=1046 "ProductName" "NVU PRO"
VIAddVersionKey /LANG=1046 "CompanyName" "NVU"
VIAddVersionKey /LANG=1046 "FileDescription" "Instalador do NVU PRO Windows"
VIAddVersionKey /LANG=1046 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1046 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=1046 "LegalCopyright" "Copyright © NVU"
VIAddVersionKey /LANG=1046 "OriginalFilename" "NVU-PRO-Setup-${VERSION}-x64.exe"

!include "MUI2.nsh"
!include "x64.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"

!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\NVUPROWindows"
!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_FINISHPAGE_RUN "$INSTDIR\NVU PRO.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Abrir a NVU PRO agora"
!define MUI_FINISHPAGE_NOREBOOTSUPPORT
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "PortugueseBR"

Var PreviousVersion
Var ForceClose
Var PurgeData
Var NvuKill
Var NvuCount

; ---- process handling: exact image path only -------------------------------------------------
; Counts (and, when $NvuKill = 1, ends) the processes whose full image path is "$INSTDIR\NVU PRO.exe".
; Other Electron applications, other copies of NVU in other folders and every other program are never touched.
!macro NVU_PROCESS_FUNCS un
Function ${un}NvuScan
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  Push $7
  Push $8
  StrCpy $NvuCount 0
  System::Alloc 65536
  Pop $0
  System::Alloc 4
  Pop $1
  System::Call 'psapi::EnumProcesses(p r0, i 65536, p r1) i .r2'
  ${If} $2 <> 0
    System::Call '*$1(i .r2)'
    IntOp $2 $2 / 4
    StrCpy $3 0
    ${While} $3 < $2
      IntOp $4 $3 * 4
      IntOp $4 $4 + $0
      System::Call '*$4(i .r5)'
      ${If} $5 > 0
        System::Call 'kernel32::OpenProcess(i 0x1000, i 0, i r5) p .r6'
        ${If} $6 <> 0
          System::Call '*$1(i 1024)'
          System::Call 'kernel32::QueryFullProcessImageNameW(p r6, i 0, w .r7, p r1) i .r8'
          System::Call 'kernel32::CloseHandle(p r6)'
          ${If} $8 <> 0
          ${AndIf} $7 == "$INSTDIR\NVU PRO.exe"
            IntOp $NvuCount $NvuCount + 1
            ${If} $NvuKill = 1
              System::Call 'kernel32::OpenProcess(i 0x00100001, i 0, i r5) p .r6'
              ${If} $6 <> 0
                DetailPrint "Encerrando NVU PRO (processo $5)"
                System::Call 'kernel32::TerminateProcess(p r6, i 1)'
                System::Call 'kernel32::WaitForSingleObject(p r6, i 8000)'
                System::Call 'kernel32::CloseHandle(p r6)'
              ${EndIf}
            ${EndIf}
          ${EndIf}
        ${EndIf}
      ${EndIf}
      IntOp $3 $3 + 1
    ${EndWhile}
  ${EndIf}
  System::Free $0
  System::Free $1
  Pop $8
  Pop $7
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; Leaves the NVU PRO of $INSTDIR closed, or aborts with exit code 5. Interactive: asks first. Silent: only with /FORCECLOSE.
Function ${un}NvuEnsureClosed
  StrCpy $NvuKill 0
  Call ${un}NvuScan
  ${While} $NvuCount > 0
    ${If} ${Silent}
      ${If} $ForceClose == "1"
        StrCpy $NvuKill 1
        Call ${un}NvuScan
        StrCpy $NvuKill 0
        Call ${un}NvuScan
        ${If} $NvuCount > 0
          SetErrorLevel 5
          Abort "A NVU PRO continua aberta nesta pasta."
        ${EndIf}
      ${Else}
        DetailPrint "A NVU PRO está aberta nesta pasta. Feche-a e repita, ou use /FORCECLOSE."
        SetErrorLevel 5
        Abort "A NVU PRO está aberta nesta pasta."
      ${EndIf}
    ${Else}
      MessageBox MB_YESNOCANCEL|MB_ICONEXCLAMATION "A NVU PRO está aberta nesta pasta e precisa ser fechada para continuar.$\r$\n$\r$\nSim: encerrar a NVU PRO agora. As viagens pendentes continuam salvas neste computador.$\r$\nNão: vou fechar pela bandeja do Windows (ícone da NVU → Sair da NVU) e tentar de novo.$\r$\nCancelar: sair sem alterar nada." /SD IDCANCEL IDYES kill IDNO again
      SetErrorLevel 1
      Abort "Operação cancelada."
      kill:
        StrCpy $NvuKill 1
        Call ${un}NvuScan
      again:
        StrCpy $NvuKill 0
        Call ${un}NvuScan
    ${EndIf}
  ${EndWhile}
FunctionEnd
!macroend
!insertmacro NVU_PROCESS_FUNCS ""
!insertmacro NVU_PROCESS_FUNCS "un."

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "A NVU PRO requer Windows de 64 bits."
    SetErrorLevel 3
    Abort
  ${EndIf}
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "/FORCECLOSE" $1
  ${IfNot} ${Errors}
    StrCpy $ForceClose "1"
  ${EndIf}
  ReadRegStr $PreviousVersion HKCU "${UNINSTALL_KEY}" "DisplayVersion"
FunctionEnd

Section "NVU PRO" SecMain
  SetShellVarContext current
  ; Only a folder that already holds an NVU PRO can be treated as an upgrade target.
  Call NvuEnsureClosed
  ${If} ${FileExists} "$INSTDIR\resources\app.asar"
  ${AndIf} ${FileExists} "$INSTDIR\NVU PRO.exe"
    ${If} ${FileExists} "$INSTDIR\Uninstall NVU.exe"
      DetailPrint "Atualizando a instalação anterior ($PreviousVersion) sem apagar configurações nem viagens pendentes."
      ; The previous uninstaller removes only the files it installed. User data is outside this folder and is never touched.
      ExecWait '"$INSTDIR\Uninstall NVU.exe" /S _?=$INSTDIR' $0
      DetailPrint "Desinstalador anterior: código $0"
      Delete "$INSTDIR\Uninstall NVU.exe"
    ${EndIf}
  ${EndIf}
  SetOutPath "$INSTDIR"
  File /r "${UNPACKED}\*"
  WriteUninstaller "$INSTDIR\Uninstall NVU.exe"
  CreateDirectory "$SMPROGRAMS\NVU PRO"
  CreateShortcut "$SMPROGRAMS\NVU PRO\NVU PRO.lnk" "$INSTDIR\NVU PRO.exe" "" "$INSTDIR\NVU PRO.exe" 0
  CreateShortcut "$SMPROGRAMS\NVU PRO\Desinstalar NVU PRO.lnk" "$INSTDIR\Uninstall NVU.exe"
  CreateShortcut "$DESKTOP\NVU PRO.lnk" "$INSTDIR\NVU PRO.exe" "" "$INSTDIR\NVU PRO.exe" 0
  WriteRegStr HKCU "Software\NVU\Windows" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\NVU\Windows" "Version" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "NVU PRO"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "NVU"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\NVU PRO.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall NVU.exe"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall NVU.exe" /S'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "EstimatedSize" $0
SectionEnd

Function un.onInit
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "/FORCECLOSE" $1
  ${IfNot} ${Errors}
    StrCpy $ForceClose "1"
  ${EndIf}
  ClearErrors
  ${GetOptions} $0 "/PURGE" $1
  ${IfNot} ${Errors}
    StrCpy $PurgeData "1"
  ${EndIf}
FunctionEnd

Section "Uninstall"
  SetShellVarContext current
  ; A previous-version uninstaller started by the installer runs silently with _?= and must not ask anything.
  Call un.NvuEnsureClosed
  IfFileExists "$INSTDIR\resources\app.asar" 0 keepFiles
!include "${FILES_NSH}"
  Delete "$INSTDIR\Uninstall NVU.exe"
  RMDir "$INSTDIR"
keepFiles:
  Delete "$DESKTOP\NVU PRO.lnk"
  Delete "$SMPROGRAMS\NVU PRO\NVU PRO.lnk"
  Delete "$SMPROGRAMS\NVU PRO\Desinstalar NVU PRO.lnk"
  RMDir "$SMPROGRAMS\NVU PRO"
  DeleteRegKey HKCU "Software\NVU\Windows"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  ; Settings, photos, queues and pending trips (%APPDATA%\NVU PRO and %LOCALAPPDATA%\NVU) stay unless the person asks.
  ${IfNot} ${Silent}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Remover também as configurações, fotos locais e viagens pendentes de envio guardadas neste computador?$\r$\n$\r$\nEscolha Não para mantê-las (recomendado). Elas ficam em %APPDATA%\NVU PRO." IDNO keepData
    StrCpy $PurgeData "1"
  ${EndIf}
  ${If} $PurgeData == "1"
    RMDir /r "$APPDATA\NVU PRO"
    RMDir /r "$LOCALAPPDATA\NVU"
  ${EndIf}
  keepData:
SectionEnd
