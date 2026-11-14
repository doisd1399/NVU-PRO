import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { LeaveCompanyCard } from "../../src/components/driver/LeaveCompanyCard";
import { blockedMessage, leaveFailureMessage, parseLeavePreview, preflightMessage } from "../../src/services/leaveCompanyCore";

// The real card and dialog, with the service replaced by a scripted one (see the plugin in test-leave-company-ui.mts).
const q = new URLSearchParams(location.search);
const state: any = (window as any).qaLeave = {
  previews: [] as boolean[], leaves: [] as string[], local: [] as number,
  preview: { success: true, preview: true, companyId: "dc", companyName: "DC Transportes", canLeave: true, jobsToCancel: 1, awaitingCompletion: 0 },
  unsupported: q.get("unsupported") === "1", local_result: { ok: true } as any, leaveFailures: [] as any[], leaveDelay: 0, previewError: false,
};
if (q.get("owner") === "1") state.preview = { ...state.preview, canLeave: false, blocker: "LEAVE_OWNER" };
export const previewLeaveCompany = async (_company: string, options: { fresh?: boolean } = {}) => {
  state.previews.push(Boolean(options.fresh));
  if (state.previewError) throw Object.assign(new Error("net"), { code: "functions/unavailable" });
  if (state.unsupported) return "unsupported";
  return parseLeavePreview(state.preview, "dc");
};
export const checkLocalPendingForLeave = async () => { state.local.push(Date.now()); return state.local_result; };
export const leaveCompany = async (companyId: string, diagnosticId: string) => {
  state.leaves.push(diagnosticId);
  await new Promise(resolve => setTimeout(resolve, state.leaveDelay));
  const failure = state.leaveFailures.shift();
  if (failure) throw failure;
  return { success: true, left: true, companyId, cancelledJobs: state.preview.jobsToCancel };
};
export { blockedMessage, leaveFailureMessage, preflightMessage };

createRoot(document.getElementById("root")!).render(<BrowserRouter><Routes>
  <Route path="/select-profile" element={<p data-testid="selector">Seletor de perfis</p>} />
  <Route path="*" element={<main style={{ padding: 16 }}><div className="rounded-2xl border p-4"><LeaveCompanyCard companyId="dc" /></div></main>} />
</Routes></BrowserRouter>);
