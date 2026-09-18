import fs from 'node:fs';

const root = new URL('../', import.meta.url).pathname;
const service = fs.readFileSync(new URL('../android/app/src/main/java/com/nvu/operacional/GtoObserverService.java', import.meta.url), 'utf8');
const policy = fs.readFileSync(new URL('../android/app/src/main/java/com/nvu/operacional/GtoDeterministicFlowPolicy.java', import.meta.url), 'utf8');

function requireText(text, pattern, message) {
  if (!pattern.test(text)) throw new Error(message);
}

requireText(
  policy,
  /useOrderedFreightFrames\(String state, boolean criticalTouchWindow\)[\s\S]*?return criticalTouchWindow;/,
  'a política não limita a fila ordenada à janela crítica'
);
requireText(
  service,
  /boolean criticalTouchFrame = fastTouchPulseActive \|\| selectionCoordinator\.isCriticalWindow\(\);/,
  'o caminho de captura não calcula a janela crítica'
);
requireText(
  service,
  /boolean orderedCriticalFrame = GtoDeterministicFlowPolicy\.useOrderedFreightFrames\(/,
  'o caminho de captura não chama a política de modo'
);
requireText(
  service,
  /getTripState\(\),\s*criticalTouchFrame\s*\)/,
  'o caminho de captura não passa a janela crítica à política'
);
requireText(
  service,
  /image = orderedCriticalFrame \? reader\.acquireNextImage\(\) : reader\.acquireLatestImage\(\);/,
  'latest/ordered não está selecionado dinamicamente'
);
requireText(
  service,
  /updateRealtimeFreightStructure\(source, now, continuousVisualFrame\);/,
  'a análise estrutural não reutiliza o frame visual atual'
);
requireText(
  service,
  /trustedFrame\.hasFreightList\(\)[\s\S]*?trustedFrame\.screenWidth == frame\.getWidth\(\)[\s\S]*?trustedFrame\.screenHeight == frame\.getHeight\(\)/,
  'AcceptRects confiáveis não são protegidos por geometria do mesmo frame'
);
requireText(
  service,
  /String acquireMode = orderedCriticalFrame \? "ORDERED_CRITICAL" : "LATEST_PRE_TOUCH";/,
  'o modo de aquisição não distingue janela crítica e pré-toque'
);
requireText(
  service,
  /putString\("freightFrameAcquireMode", acquireMode\)/,
  'a instrumentação do modo de aquisição não foi persistida'
);

console.log('GtoCaptureLatencyContract: PASS');
