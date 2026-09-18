import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useSessionStore } from "../context/AppContext";
import { Card, CardContent } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { auth } from "../lib/firebase";
import {
  GOOGLE_AUTH_SESSION_NOT_CONFIRMED,
  GOOGLE_IDENTITY_NOT_DISPLAYED,
  NATIVE_GOOGLE_PLUGIN_UNAVAILABLE,
  preloadGoogleIdentityServices,
  signInWithGoogleAccount,
} from "../services/googleAuthService";

export default function Login() {
  const { currentUser, authInitialized, sessionUiReady } = useSessionStore();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    preloadGoogleIdentityServices();
  }, []);


  const handleGoogleLogin = async () => {
    setLoading(true);
    setError("");

    try {
      const user = await signInWithGoogleAccount();
      // The auth service returns only after the provider credential is accepted.
      // Wait for Firebase's own state barrier, then perform exactly one handoff
      // to the profile selector. No membership effect or retry owns navigation.
      await auth.authStateReady();
      if (auth.currentUser?.uid !== user.uid) {
        throw new Error("GOOGLE_AUTH_SESSION_NOT_CONFIRMED");
      }
      navigate("/select-profile", { replace: true });
    } catch (err: any) {
      const errStr = String(err?.message || "") + " " + String(err?.code || "") + " " + String(err?.name || "");
      const normalizedErrStr = errStr.toLowerCase();
      const isCancel =
        err?.code === "auth/popup-closed-by-user" ||
        err?.code === "auth/cancelled-popup-request" ||
        normalizedErrStr.includes("12501") ||
        normalizedErrStr.includes("cancel") ||
        normalizedErrStr.includes("fechar");
      const nativePluginUnavailable =
        err?.message === NATIVE_GOOGLE_PLUGIN_UNAVAILABLE ||
        normalizedErrStr.includes("native_google_plugin_unavailable");
      const isCredentialManager =
        normalizedErrStr.includes("credential manager") ||
        normalizedErrStr.includes("credentialmanager") ||
        normalizedErrStr.includes("getcredentialunsupportedexception") ||
        normalizedErrStr.includes("createcredentialexception") ||
        normalizedErrStr.includes("unsupportedoperationexception") ||
        normalizedErrStr.includes("provider configuration") ||
        normalizedErrStr.includes("no credential provider") ||
        normalizedErrStr.includes("play services") ||
        normalizedErrStr.includes("not supported");

      const isPopupBlocked = err?.code === "auth/popup-blocked";
      const isPopupClosed = err?.code === "auth/popup-closed-by-user";
      const isOperationNotAllowed = err?.code === "auth/operation-not-allowed";
      const isNetworkFailure = err?.code === "auth/network-request-failed";

      if (isPopupClosed || isCancel) {
        console.info("[Login] Login Google cancelado pelo usuário");
        setError("Login cancelado. Você pode tentar novamente quando quiser.");
      } else if (isPopupBlocked) {
        setError("O navegador bloqueou a janela do Google. Permita pop-ups para este domínio e tente novamente.");
      } else if (nativePluginUnavailable) {
        setError("Login nativo do Google indisponível neste APK. Atualize o aplicativo e tente novamente.");
      } else if (isCredentialManager) {
        setError("Não foi possível abrir o login com Google neste dispositivo. Atualize os Serviços do Google Play e tente novamente.");
      } else if (err?.code === "auth/unauthorized-domain") {
        setError("Este domínio não está autorizado no Firebase Authentication. Autorize stirring-pavlova-ca6808.netlify.app e tente novamente.");
      } else if (isOperationNotAllowed) {
        setError("O provedor Google não está habilitado no Firebase Authentication.");
      } else if (isNetworkFailure) {
        setError("Não foi possível concluir o login por uma falha de rede. Verifique sua conexão e tente novamente.");
      } else if (normalizedErrStr.includes(GOOGLE_AUTH_SESSION_NOT_CONFIRMED.toLowerCase())) {
        setError("O Google autenticou, mas a sessão ainda não foi confirmada. Tente novamente.");
      } else if (normalizedErrStr.includes(GOOGLE_IDENTITY_NOT_DISPLAYED.toLowerCase())) {
        setError("O seletor Google não foi exibido. Verifique se o domínio está autorizado e tente novamente.");
      } else {
        setError("Erro ao fazer login com Google: " + (err?.message || "Erro desconhecido"));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#09090b] flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-[#fafafa] tracking-tight mb-2">
            NVU
          </h1>
          <p className="text-slate-500 dark:text-[#a1a1aa] text-sm font-medium">
            Gestão Operacional de Logística
          </p>
        </div>

        <Card className="rounded-3xl border border-slate-200/60 dark:border-[#2A2F3A] shadow-xl dark:shadow-none overflow-hidden bg-white dark:bg-[#1A1F26]">
          <CardContent className="p-8">
            <h2 className="text-lg font-bold text-slate-900 dark:text-[#fafafa] mb-6 text-center">
              Fazer Login
            </h2>

            {error && (
              <div className="bg-red-50 dark:bg-red-500/10 border border-transparent dark:border-red-500/20 text-red-600 dark:text-red-400 text-sm px-4 py-3 rounded-xl mb-6 text-center">
                {error}
              </div>
            )}

            <div className="space-y-4">
              <Button
                onClick={handleGoogleLogin}
                disabled={loading}
                className="w-full h-12 bg-white dark:bg-[#27272a]/50 hover:bg-slate-50 dark:hover:bg-[#27272a] text-slate-700 dark:text-[#e4e4e7] border border-slate-200 dark:border-[#2A2F3A]/50 shadow-sm dark:shadow-none transition-all rounded-xl relative flex justify-center items-center"
              >
                {loading ? (
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-slate-800 dark:border-slate-400"></div>
                ) : (
                  <>
                    <svg
                      className="w-5 h-5 absolute left-4"
                      viewBox="0 0 24 24"
                    >
                      <path
                        fill="currentColor"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      />
                    </svg>
                    <span className="font-semibold text-[15px]">
                      Entrar com Google
                    </span>
                  </>
                )}
              </Button>
            </div>
            
            <div className="mt-6 text-center">
              <button
                onClick={() => navigate('/')}
                className="text-sm font-semibold text-slate-500 hover:text-slate-700 dark:text-[#a1a1aa] dark:hover:text-[#e4e4e7] transition-colors"
              >
                Voltar
              </button>
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-xs font-semibold text-slate-400 dark:text-[#71717a] mt-8">
          NVU © {new Date().getFullYear()} — Plataforma Operacional
        </p>
      </div>
    </div>
  );
}
