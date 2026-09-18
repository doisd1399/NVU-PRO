import { auth, functions } from './firebase';
import { Capacitor } from '@capacitor/core';
import { isAuthTeardownActive } from './authLifecycle';
import { httpsCallable } from 'firebase/functions';

export type PushContext = {
  userId?: string | null;
  companyId?: string | null;
  activeProfile?: string | null;
};

let cachedToken: string | null = null;
let registrationPromise: Promise<void> | null = null;
let listenersAdded = false;
let lastContext: PushContext = {};
let pushContextGeneration = 0;

/**
 * Drop all user-specific push state before Firebase Auth is signed out.
 * Native listeners stay installed so the APK can keep using the same plugin
 * instance after the next login, but a late token callback cannot target the
 * previous user's Firestore document.
 */
export function clearPushRegistrationContext() {
  pushContextGeneration += 1;
  cachedToken = null;
  registrationPromise = null;
  lastContext = {};
}

export async function registerDeviceForPush(context?: PushContext) {
  if (isAuthTeardownActive()) return;
  lastContext = context ? { ...lastContext, ...context } : lastContext;

  // AppContext atualiza este método quando perfil ou empresa mudam. O plugin
  // nativo precisa ser registrado apenas uma vez por sessão; chamadas
  // sobrepostas podem gerar callbacks de registro repetidos em alguns aparelhos.
  if (registrationPromise) {
    const activeContext = lastContext;
    if (
      cachedToken &&
      activeContext.userId &&
      auth.currentUser?.uid === activeContext.userId
    ) {
      await saveTokenToFirestore(activeContext, cachedToken);
    }
    return registrationPromise;
  }

  const invocationGeneration = pushContextGeneration;
  console.log('[NVU PUSH BOOT] função iniciada', lastContext);
  
  if (!Capacitor.isNativePlatform()) {
    console.log('[NVU PUSH PLATFORM] Ambiente não é nativo (Web). Push abortado.');
    return;
  }

  registrationPromise = (async () => {
    try {
      console.log('[NVU PUSH PLATFORM] Plataforma nativa detectada:', Capacitor.getPlatform());
      const mod = await import('@capacitor/push-notifications');
      const { PushNotifications } = mod;
      console.log('[NVU PUSH PLUGIN] Capacitor PushNotifications carregado');

      if (
        invocationGeneration !== pushContextGeneration ||
        isAuthTeardownActive()
      ) {
        return;
      }

      if (!listenersAdded) {
        console.log('[NVU PUSH SETUP] Adicionando listeners do Capacitor PushNotifications...');

        // O APK remoto pode recarregar o WebView quando um deploy troca os
        // chunks hashados. O estado JavaScript é recriado nesse cenário,
        // enquanto alguns bridges nativos ainda podem manter callbacks da
        // página anterior. Limpar apenas os listeners deste plugin antes de
        // registrar o conjunto canônico evita duplicação sem tocar em Auth,
        // Firestore ou nos emissores das Cloud Functions.
        await PushNotifications.removeAllListeners();

        PushNotifications.addListener('registration', async (token) => {
          if (isAuthTeardownActive()) return;
          console.log('[NVU PUSH TOKEN] token recebido:', token.value);
          cachedToken = token.value;

          const activeContext = lastContext;
          if (
            activeContext.userId &&
            auth.currentUser?.uid === activeContext.userId
          ) {
            await saveTokenToFirestore(activeContext, token.value);
          } else {
            console.log('[NVU PUSH TOKEN] Token recebido mas sem userId no contexto, aguardando login para salvar.');
          }
        });

        PushNotifications.addListener('registrationError', (error: any) => {
          if (!isAuthTeardownActive()) {
            console.warn('[NVU PUSH ERROR] erro no registro:', error);
          }
        });

        PushNotifications.addListener('pushNotificationReceived', (notification) => {
          console.log('[NVU PUSH DEBUG] notificação recebida:', notification);
          window.dispatchEvent(new CustomEvent('nvu-push-received', { detail: notification }));
        });

        PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
          console.log('[NVU PUSH DEBUG] notificação clicada:', action);
          window.dispatchEvent(new CustomEvent('nvu-push-opened', { detail: action }));
        });
        listenersAdded = true;
      }

      if (
        invocationGeneration !== pushContextGeneration ||
        isAuthTeardownActive()
      ) {
        return;
      }

      const activeContext = lastContext;
      if (
        activeContext.userId &&
        auth.currentUser?.uid === activeContext.userId &&
        cachedToken
      ) {
        console.log('[NVU PUSH REGISTER] Token já estava em cache, salvando no Firestore...');
        await saveTokenToFirestore(activeContext, cachedToken);
      }

      if (
        invocationGeneration !== pushContextGeneration ||
        isAuthTeardownActive()
      ) {
        return;
      }

      console.log('[NVU PUSH PERMISSION] requestPermissions iniciado');
      let permStatus = await PushNotifications.requestPermissions();
      console.log('[NVU PUSH PERMISSION] resultado da permissão:', permStatus);

      if (permStatus.receive === 'granted') {
        console.log('[NVU PUSH REGISTER] register iniciado');
        await PushNotifications.register();
      } else {
        console.log('[NVU PUSH ERROR] permissão negada pelo usuário.');
      }
    } catch (error) {
      console.warn('[NVU PUSH ERROR] Push Capacitor indisponível ou falhou', error);
    }
  })();

  return registrationPromise;
}

async function saveTokenToFirestore(context: PushContext, tokenValue: string) {
  if (
    !context.userId ||
    isAuthTeardownActive() ||
    auth.currentUser?.uid !== context.userId
  )
    return;
  try {
    const registerPushDevice = httpsCallable(functions, 'registerPushDevice');
    await registerPushDevice({
      token: tokenValue,
      platform: Capacitor.getPlatform(),
      companyId: context.companyId ?? null,
      activeProfile: context.activeProfile ?? null,
    });
    console.log('[NVU PUSH REGISTER] Token canônico salvo para o usuário:', context.userId);
  } catch (dbError) {
    if (
      !isAuthTeardownActive() &&
      auth.currentUser?.uid === context.userId
    ) {
      console.warn('[NVU PUSH ERROR] Falha ao registrar token canônico:', dbError);
    }
  }
}
