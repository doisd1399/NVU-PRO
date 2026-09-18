import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Package, Truck, ArrowRight, ShieldCheck, LogIn, UserRound } from "lucide-react";
import { useSessionStore } from "../context/AppContext";
import { preloadRoute } from "../lib/routePreload";

export default function Portal() {
  const navigate = useNavigate();
  const {
    currentUser,
    authInitialized,
    sessionReady,
    sessionUiReady,
    sessionRecovering,
    activeRole,
    profileIndex,
  } = useSessionStore();
  const [showSubscribeOptions, setShowSubscribeOptions] = useState(false);

  useEffect(() => {
    // Login for an already-authenticated user is a critical path. Warm the
    // login and selector immediately while the portal is visible.
    void preloadRoute("/login");
    void preloadRoute("/select-profile");
    if (currentUser || sessionRecovering || !authInitialized) {
      void preloadRoute("/select-profile");
    }
    if (sessionReady && currentUser) {
      void preloadRoute(activeRole === "admin" ? "/admin/fleet" : "/driver/profile");
    }
  }, [activeRole, authInitialized, currentUser?.id, sessionRecovering, sessionReady]);

  useEffect(() => {
    if (!showSubscribeOptions) return;
    void preloadRoute("/apply");
    void preloadRoute("/register-company");
  }, [showSubscribeOptions]);

  // currentUser is set only from a Firebase-authoritative identity (or its
  // immediate Firebase fallback), never from membership cache alone. It is
  // therefore the earliest safe signal for the explicit selector action.
  // The portal is a public entry surface. A transient Firebase/WebView
  // hydration state must never replace the two actionable states: a cached
  // identity goes to the selector, otherwise the user can open Login now.
  // Protected routes still require the strict sessionReady guard elsewhere.
  const hasRestoredIdentity = Boolean(currentUser) || Boolean(sessionUiReady);
  const hasApprovedProfile =
    profileIndex.status === "ready" && profileIndex.profiles.length > 0;

  const openLogin = () => {
    // Identity alone never authorizes the selector. Until the canonical profile
    // index confirms at least one valid active membership, the only safe surface
    // is Pendências; it also covers the transient resolving/error states.
    if (hasRestoredIdentity) {
      navigate(hasApprovedProfile ? "/select-profile" : "/pending-applications", {
        replace: true,
        ...(hasApprovedProfile
          ? { state: { nvuExplicitProfileSelection: true } }
          : {}),
      });
      return;
    }
    navigate("/login");
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
              Acesse sua conta
            </h2>

            <div className="space-y-4">
              {!showSubscribeOptions ? (
                <>
                  <Button
                    onClick={openLogin}
                    disabled={false}
                    aria-busy={false}
                    className="w-full h-12 bg-white dark:bg-[#27272a]/50 hover:bg-slate-50 dark:hover:bg-[#27272a] text-slate-700 dark:text-[#e4e4e7] border border-slate-200 dark:border-[#2A2F3A]/50 shadow-sm dark:shadow-none transition-all rounded-xl font-semibold text-[15px] flex items-center justify-center gap-2 disabled:cursor-wait disabled:opacity-80"
                  >
                    {hasRestoredIdentity ? (
                      <UserRound size={18} className="text-blue-500" />
                    ) : (
                      <LogIn size={18} className="text-blue-500" />
                    )}
                    {hasRestoredIdentity
                      ? hasApprovedProfile
                        ? "Escolher perfil"
                        : "Pendências"
                      : "Fazer Login"}
                  </Button>

                  <div className="relative py-4 text-center">
                    <span className="w-full border-t border-slate-200 dark:border-[#2A2F3A] absolute top-1/2 left-0 -translate-y-1/2" />
                    <span className="bg-white dark:bg-[#1A1F26] px-3 relative text-[11px] font-bold text-slate-400 dark:text-[#71717a] uppercase tracking-widest">
                      Acesso Corporativo
                    </span>
                  </div>

                  <Button
                    onClick={() => setShowSubscribeOptions(true)}
                    className="w-full h-12 bg-slate-900 dark:bg-blue-600 hover:bg-slate-800 dark:hover:bg-blue-500 text-white shadow-md dark:shadow-none transition-all rounded-xl font-semibold text-[15px] flex items-center justify-center gap-2"
                  >
                    <ShieldCheck
                      size={18}
                      className="text-emerald-400 dark:text-white"
                    />
                    Quero me inscrever
                  </Button>
                </>
              ) : (
                <div className="flex flex-col gap-3 animate-in fade-in slide-in-from-bottom-2 duration-200">
                  <Button
                    onClick={() => navigate('/apply')}
                    className="w-full h-12 bg-slate-900 dark:bg-blue-600 hover:bg-slate-800 dark:hover:bg-blue-500 text-white shadow-md dark:shadow-none transition-all rounded-xl font-semibold text-[15px] flex items-center justify-start px-5 gap-3"
                  >
                    <Truck
                      size={20}
                      className="text-emerald-400 dark:text-white"
                    />
                    Inscrição para Motoristas
                    <ArrowRight size={18} className="ml-auto opacity-70" />
                  </Button>

                  <Button
                    onClick={() => navigate('/register-company')}
                    className="w-full h-12 bg-white dark:bg-[#27272a]/50 border border-slate-200 dark:border-[#2A2F3A]/50 hover:bg-slate-50 dark:hover:bg-[#27272a] text-slate-700 dark:text-[#e4e4e7] shadow-sm dark:shadow-none transition-all rounded-xl font-semibold text-[15px] flex items-center justify-start px-5 gap-3"
                  >
                    <Package
                      size={20}
                      className="text-blue-500 dark:text-blue-400"
                    />
                    Cadastro de Empresa
                    <ArrowRight size={18} className="ml-auto opacity-70" />
                  </Button>

                  <div className="mt-4 text-center">
                    <button
                      onClick={() => setShowSubscribeOptions(false)}
                      className="text-sm font-semibold text-slate-500 hover:text-slate-700 dark:text-[#a1a1aa] dark:hover:text-[#e4e4e7] transition-colors"
                    >
                      Voltar
                    </button>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-xs font-semibold text-slate-400 dark:text-[#71717a] mt-8 flex justify-center gap-2">
          <span>NVU © {new Date().getFullYear()} — Plataforma Operacional</span>
          <button onClick={() => navigate('/diagnostics')} className="hover:text-slate-600 dark:hover:text-[#e4e4e7] transition-colors" title="Diagnóstico de Conectividade">
            •
          </button>
        </p>
      </div>
    </div>
  );
}