#!/usr/bin/env bash
# EVIDÊNCIA EMULADA (Wine sobre Linux) — NÃO é Windows nativo e não substitui windows-ci.yml.
# Executa o instalador final NVU-PRO-Setup-<versão>-x64.exe pelos fluxos que importam:
# instalação silenciosa, identidade, atualização no mesmo lugar, recusa com a NVU aberta,
# /FORCECLOSE só na pasta alvo, programa homônimo em outra pasta preservado, desinstalação
# que mantém dados do usuário, relatório de versões reais do aplicativo empacotado e perda do bloqueio de instância única.
#
# Uso:  bash desktop/windows/tests/e2e/wine-installer-check.sh <instalador.exe> <pasta-do-prefixo-wine>
# Requer: wine (+wine32 para o instalador NSIS de 32 bits), Xvfb, strings.
# Segurança: usa apenas o prefixo informado (um prefixo descartável!). Nunca usa pkill/killall por nome;
#            encerra somente o que ele mesmo iniciou e os processos do próprio prefixo (wineserver -k).
set -u
[ "$#" -eq 2 ] || { echo "uso: $0 <instalador.exe> <pasta-do-prefixo-wine>" >&2; exit 2; }
INSTALLER="$(readlink -f "$1")"
[ -f "$INSTALLER" ] || { echo "instalador não encontrado: $1" >&2; exit 2; }
mkdir -p "$2"; PREFIX="$(readlink -f "$2")"
export WINEPREFIX="$PREFIX" WINEDEBUG=-all WINEDLLOVERRIDES="mscoree,mshtml="

XVFB_PID=""
if [ -z "${DISPLAY:-}" ]; then
  export DISPLAY=:77
  if [ ! -e /tmp/.X11-unix/X77 ]; then Xvfb :77 -screen 0 1280x800x24 >/dev/null 2>&1 & XVFB_PID=$!; sleep 1; fi
fi
FIFO_DIR="$(mktemp -d)"
cleanup() { exec 8>&- 9>&-; wineserver -k 2>/dev/null; [ -n "$XVFB_PID" ] && kill "$XVFB_PID" 2>/dev/null; rm -rf "$FIFO_DIR"; }
trap cleanup EXIT

C="$WINEPREFIX/drive_c"; ME="$(whoami)"; U="$C/users/$ME/AppData/Roaming/NVU PRO"; PASS=0; FAIL=0
ok()    { echo "PASS $1"; PASS=$((PASS+1)); }
bad()   { echo "FAIL $1"; FAIL=$((FAIL+1)); }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }
count_proc() { pgrep -af "$1" | grep -v -e pgrep -e "bash " | wc -l; }
REG='HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\NVUPROWindows'

wine wineboot -u >/dev/null 2>&1; wineserver -w 2>/dev/null
wineserver -k 2>/dev/null; rm -rf "$C/NVU-Test" "$C/Other" "$C/versions.json"
mkdir -p "$U"; echo '{"version":1,"bindings":{},"events":{}}' > "$U/pro-journal.json"

wine "$INSTALLER" /S /D='C:\NVU-Test'
check "instalação silenciosa limpa instala o aplicativo e o plugin com manifesto" \
  '[ -f "$C/NVU-Test/NVU PRO.exe" ] && [ -f "$C/NVU-Test/resources/plugin/nvu_scs_telemetry.manifest.json" ] && [ -f "$C/NVU-Test/resources/plugin/nvu_scs_telemetry.dll" ]'
check "registro de desinstalação, atalho e identidade do executável (NVU PRO)" \
  'wine reg query "$REG" 2>/dev/null | grep -q "DisplayName.*NVU PRO" && [ -f "$C/users/$ME/Desktop/NVU PRO.lnk" ] && strings -e l "$C/NVU-Test/NVU PRO.exe" | grep -q "^NVU PRO$"'

wine "$INSTALLER" /S /D='C:\NVU-Test'
check "atualização por cima mantém o aplicativo e os dados do usuário" \
  '[ -f "$C/NVU-Test/NVU PRO.exe" ] && [ -f "$U/pro-journal.json" ]'

# Impostor: um executável qualquer chamado "NVU PRO.exe" (cópia do cmd.exe) na pasta alvo e outro em outra pasta.
cp "$C/NVU-Test/NVU PRO.exe" "$C/NVU PRO.exe.real"
cp "$C/windows/system32/cmd.exe" "$C/NVU-Test/NVU PRO.exe"; mkdir -p "$C/Other"; cp "$C/windows/system32/cmd.exe" "$C/Other/NVU PRO.exe"
mkfifo "$FIFO_DIR/a" "$FIFO_DIR/b"; exec 8<>"$FIFO_DIR/a" 9<>"$FIFO_DIR/b"
wine 'C:\NVU-Test\NVU PRO.exe' /c pause <&8 >/dev/null 2>&1 &
wine 'C:\Other\NVU PRO.exe'    /c pause <&9 >/dev/null 2>&1 &
sleep 5
wine "$INSTALLER" /S /D='C:\NVU-Test'; CODE=$?
check "instalação silenciosa com a NVU da pasta aberta é recusada (código 5) sem substituir nada" \
  '[ "$CODE" = 5 ] && [ "$(stat -c %s "$C/NVU-Test/NVU PRO.exe")" -lt 5000000 ]'
wine "$INSTALLER" /S /FORCECLOSE /D='C:\NVU-Test'; CODE=$?
check "/FORCECLOSE encerra só a NVU daquela pasta e conclui a instalação" \
  '[ "$CODE" = 0 ] && [ "$(stat -c %s "$C/NVU-Test/NVU PRO.exe")" -gt 100000000 ]'
check "programa homônimo em OUTRA pasta continua em execução" \
  '[ "$(count_proc "C:.Other.NVU PRO.exe")" -ge 1 ]'
exec 8>&- 9>&-

wine 'C:\NVU-Test\Uninstall NVU.exe' /S; sleep 6
check "desinstalação silenciosa remove programa e registro e mantém os dados do usuário" \
  '[ ! -d "$C/NVU-Test" ] && ! wine reg query "$REG" >/dev/null 2>&1 && [ -f "$U/pro-journal.json" ]'

wine "$INSTALLER" /S /D='C:\NVU-Test'
timeout 150 wine 'C:\NVU-Test\NVU PRO.exe' --no-sandbox --disable-gpu '--nvu-versions-out=C:\versions.json' >/dev/null 2>&1
check "aplicativo empacotado informa as versões reais (--nvu-versions-out)" \
  'grep -q "\"packaged\": true" "$C/versions.json" && grep -q "\"consistent\": true" "$C/versions.json"'

# 2ª execução do aplicativo empacotado com a 1ª viva. Limite do emulador: o Electron nem cria BrowserWindow sob este Wine
# (um aplicativo Electron mínimo trava no mesmo ponto), então a 1ª instância fica parada antes de se registrar e a 2ª não
# identifica o dono (código 3). No Windows real a 2ª identifica o dono (código 0 = mesma versão já aberta).
LOG="$U/logs/nvu.log"; mkdir -p "$U/logs"; : > "$LOG"; rm -f "$U/instance.json"
wine 'C:\NVU-Test\NVU PRO.exe' --no-sandbox --disable-gpu >/dev/null 2>&1 &
FIRST=$!
for _ in $(seq 1 90); do grep -q '"step":"protocol"' "$LOG" 2>/dev/null && break; sleep 1; done
sleep 8
BEFORE=$(wc -l < "$LOG")
wine 'C:\NVU-Test\NVU PRO.exe' --no-sandbox --disable-gpu --nvu-no-dialogs >/dev/null 2>&1; CODE=$?
SECOND_LINES="$(tail -n +$((BEFORE+1)) "$LOG")"
check "2ª execução do aplicativo empacotado perde o bloqueio, não roda etapas de inicialização e sai (código 0 ou 3)" \
  '{ [ "$CODE" = 0 ] || [ "$CODE" = 3 ]; } && echo "$SECOND_LINES" | grep -q "instance.lock_lost" && ! echo "$SECOND_LINES" | grep -q "startup.step_ok"'
check "a 1ª instância continua em execução depois da 2ª" 'kill -0 "$FIRST" 2>/dev/null'

echo "WINE_INSTALLER_CHECK $PASS aprovados / $FAIL reprovados (Wine, não Windows)"
[ "$FAIL" = 0 ]
