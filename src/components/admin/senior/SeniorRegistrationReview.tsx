import { CachedImage } from "../../common/CachedImage";
import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Building2, ChevronLeft, Users } from "lucide-react";
import { Card, CardContent } from "../../ui/Card";
import { Button } from "../../ui/Button";
import { registerOptionModal } from "../../../lib/optionModalStack";
import { registrationSubmissionLabel } from "../../../lib/registrationSubmission";

export function SeniorRegistrationReview({ registration: reg, onClose, onImage, onApprove, onReject, covered }: {
  registration: any; onClose: () => void; onImage: (url: string) => void;
  onApprove: (id: string) => void; onReject: (id: string) => void; covered: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const coveredRef = useRef(covered); coveredRef.current = covered;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const modal = registerOptionModal(onClose);
    root.current?.focus({ preventScroll: true });
    const handleKey = (event: KeyboardEvent) => {
      if (!modal.isTop() || coveredRef.current) return;
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key === "Tab") {
        const controls = Array.from(root.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], textarea:not([readonly])') || []).filter(element => element.getClientRects().length);
        if (!controls.length) { event.preventDefault(); return; }
        const first = controls[0], last = controls.at(-1)!;
        if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === root.current)) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => { document.removeEventListener("keydown", handleKey); modal.dispose(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [onClose]);
  return createPortal(<div ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="senior-review-title" className="nvu-senior-review">
    <header className="nvu-senior-review-header">
      <button type="button" onClick={onClose} aria-label="Voltar ao Painel Sênior"><ChevronLeft size={19} /> Voltar</button>
      <h2 id="senior-review-title">Análise de cadastro</h2>
      <span className="nvu-senior-review-status">{reg.status === "pending" ? "Em análise" : reg.status === "approved" ? "Aprovada" : "Recusada"}</span>
    </header>
    <div className="nvu-senior-review-scroll"><div className="nvu-senior-review-content">
      <div className="nvu-senior-review-intro"><h1>NVU</h1><p>Dados enviados para análise</p></div>
                  <Card className="rounded-[16px] border border-slate-200 dark:border-nvu-line shadow-sm bg-white dark:bg-nvu-surface">
                    <CardContent className="p-4 sm:p-5 space-y-5">
                      
                      <div className="space-y-3">
                        <h3 className="text-[11px] font-bold text-slate-400 dark:text-nvu-muted uppercase tracking-wider border-b border-slate-100 dark:border-nvu-line pb-1.5 mb-3">Dados da Empresa & Documentos</h3>
                        
                        <div className="flex items-center gap-3 bg-slate-50 dark:bg-nvu-page/50 p-2.5 rounded-xl border border-slate-200/60 dark:border-nvu-line w-full mb-1">
                          <div className="relative shrink-0">
                            {reg.companyLogoURL ? (
                              <button onClick={() => onImage(reg.companyLogoURL!)} className="block w-12 h-12 rounded-lg overflow-hidden border border-slate-200 dark:border-nvu-line shadow-sm relative hover:opacity-80 transition-opacity">
                                <CachedImage
                                  src={reg.companyLogoURL}
                                  alt="Logo"
                                  className="w-full h-full object-cover"
                                  referrerPolicy="no-referrer"
                                />
                              </button>
                            ) : (
                              <div className="w-12 h-12 rounded-lg bg-slate-100 dark:bg-nvu-surface border border-dashed border-slate-300 dark:border-nvu-line flex items-center justify-center">
                                <Building2 size={16} className="text-slate-400 dark:text-nvu-muted" />
    </div>
                            )}
    </div>
                          <div className="flex-1 min-w-0">
                            <label className="block text-[13px] font-semibold text-slate-800 dark:text-nvu-text-soft mb-0.5">
                              Logo da Empresa
                            </label>
                            <p className="text-[11px] text-slate-500 dark:text-nvu-muted truncate">
                              {reg.companyLogoURL ? "Clique para ampliar" : "Não enviada"}
                            </p>
    </div>
    </div>

                        <div>
                          <label className="block text-[12px] font-medium text-slate-600 dark:text-nvu-text-soft mb-1 ml-0.5">
                            Nome da Empresa
                          </label>
                          <input
                            readOnly
                            value={reg.companyName}
                            className="w-full bg-slate-50 dark:bg-nvu-page border border-slate-200 dark:border-nvu-line rounded-lg px-3 h-10 text-[14px] outline-none text-slate-900 dark:text-nvu-text cursor-default font-medium"
                          />
    </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[12px] font-medium text-slate-600 dark:text-nvu-text-soft mb-1 ml-0.5">
                              CNPJ
                            </label>
                            <input
                              readOnly
                              value={reg.cnpj}
                              className="w-full bg-slate-50 dark:bg-nvu-page border border-slate-200 dark:border-nvu-line rounded-lg px-3 h-10 text-[14px] outline-none text-slate-900 dark:text-nvu-text cursor-default font-medium"
                            />
    </div>
                          <div>
                            <label className="block text-[12px] font-medium text-slate-600 dark:text-nvu-text-soft mb-1 ml-0.5">
                              Simulador
                            </label>
                            <input
                              readOnly
                              value={reg.simulatorName || "N/A"}
                              className="w-full bg-slate-50 dark:bg-nvu-page border border-slate-200 dark:border-nvu-line rounded-lg px-3 h-10 text-[14px] outline-none text-slate-900 dark:text-nvu-text cursor-default font-medium"
                            />
    </div>
    </div>
    </div>

                      <div className="space-y-3 pt-3">
                        <h3 className="text-[11px] font-bold text-slate-400 dark:text-nvu-muted uppercase tracking-wider border-b border-slate-100 dark:border-nvu-line pb-1.5 mb-3">Dados do Proprietário</h3>

                        <div className="flex items-center gap-3 bg-slate-50 dark:bg-nvu-page/50 p-2.5 rounded-xl border border-slate-200/60 dark:border-nvu-line w-full mb-1">
                          <div className="relative shrink-0">
                            {reg.ownerPhotoUrl ? (
                              <button onClick={() => onImage(reg.ownerPhotoUrl!)} className="block w-12 h-12 rounded-lg overflow-hidden border border-slate-200 dark:border-nvu-line shadow-sm relative hover:opacity-80 transition-opacity">
                                <CachedImage
                                  src={reg.ownerPhotoUrl}
                                  alt="Owner"
                                  className="w-full h-full object-cover"
                                  referrerPolicy="no-referrer"
                                />
                              </button>
                            ) : (
                              <div className="w-12 h-12 rounded-lg bg-slate-100 dark:bg-nvu-surface border border-dashed border-slate-300 dark:border-nvu-line flex items-center justify-center">
                                <Users size={16} className="text-slate-400 dark:text-nvu-muted" />
    </div>
                            )}
    </div>
                          <div className="flex-1 min-w-0">
                            <label className="block text-[13px] font-semibold text-slate-800 dark:text-nvu-text-soft mb-0.5">
                              Foto do Proprietário
                            </label>
                            <p className="text-[11px] text-slate-500 dark:text-nvu-muted truncate">
                              {reg.ownerPhotoUrl ? "Clique para ampliar" : "Não enviada"}
                            </p>
    </div>
    </div>

                        <div>
                          <label className="block text-[12px] font-medium text-slate-600 dark:text-nvu-text-soft mb-1 ml-0.5">
                            Nome do Proprietário
                          </label>
                          <input
                            readOnly
                            value={reg.ownerName}
                            className="w-full bg-slate-50 dark:bg-nvu-page border border-slate-200 dark:border-nvu-line rounded-lg px-3 h-10 text-[14px] outline-none text-slate-900 dark:text-nvu-text cursor-default font-medium"
                          />
    </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[12px] font-medium text-slate-600 dark:text-nvu-text-soft mb-1 ml-0.5">
                              Email
                            </label>
                            <input
                              readOnly
                              value={reg.email || "N/A"}
                              className="w-full bg-slate-50 dark:bg-nvu-page border border-slate-200 dark:border-nvu-line rounded-lg px-3 h-10 text-[14px] outline-none text-slate-900 dark:text-nvu-text cursor-default font-medium"
                            />
    </div>
                          <div>
                            <label className="block text-[12px] font-medium text-slate-600 dark:text-nvu-text-soft mb-1 ml-0.5">
                              WhatsApp
                            </label>
                            <input
                              readOnly
                              value={reg.whatsapp || "N/A"}
                              className="w-full bg-slate-50 dark:bg-nvu-page border border-slate-200 dark:border-nvu-line rounded-lg px-3 h-10 text-[14px] outline-none text-slate-900 dark:text-nvu-text cursor-default font-medium"
                            />
    </div>
    </div>
    </div>

                      <div className="space-y-3 pt-3 border-t border-slate-100 dark:border-nvu-line">
                        <div className="flex justify-between items-center px-1">
                          <span className="text-[11px] font-bold text-slate-400 dark:text-nvu-muted uppercase tracking-wider">Envio do cadastro:</span>
                          <span className="text-[12px] font-medium text-slate-600 dark:text-nvu-muted">{registrationSubmissionLabel(reg)}</span>
    </div>
                        {reg.status !== "pending" && (
                          <div className="pt-2">
                             <label className="text-[11px] font-bold text-slate-400 dark:text-nvu-muted uppercase tracking-wider block mb-1">Parecer Registrado:</label>
                             <textarea readOnly value={reg.rejectionReason || "Nenhuma observação informada no sistema."} className="w-full h-16 bg-slate-50 dark:bg-nvu-page px-3 py-2 rounded-lg border border-slate-200 dark:border-nvu-line text-[13px] font-medium text-slate-600 dark:text-nvu-muted resize-none outline-none cursor-default"/>
    </div>
                        )}
    </div>

                    </CardContent>
                  </Card>
    </div></div>
    {reg.status === "pending" && <footer className="nvu-senior-review-footer"><div>
      <Button type="button" variant="outline" onClick={() => onReject(reg.id)}>Recusar</Button>
      <Button type="button" className="nvu-senior-review-approve" onClick={() => onApprove(reg.id)}>Aprovar e Ativar</Button>
    </div></footer>}
  </div>, document.body);
}
