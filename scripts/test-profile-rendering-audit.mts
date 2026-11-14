import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React, { act, lazy, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { applyAuthoritativeJobProjection } from "../src/lib/authoritativeJobProjection";

const dom = new JSDOM('<div id="root"></div>', { url: "http://127.0.0.1/render-audit", pretendToBeVisual: true });
for (const name of ["window", "document", "localStorage", "CustomEvent", "Event", "navigator", "Image"]) {
  Object.defineProperty(globalThis, name, { value: (dom.window as any)[name], configurable: true });
}
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const { useInitialOperationIntegrity } = await import("../src/hooks/useInitialOperationIntegrity");
const { RetainedPanel, PanelLoading } = await import("../src/components/common/RetainedPanel");
const { useVehiclePhoto } = await import("../src/hooks/useVehiclePhoto");
const { vehiclePhotoService } = await import("../src/services/vehiclePhotoService");
vehiclePhotoService.load = async () => null;
let root = createRoot(document.getElementById("root")!);
const tick = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
let integrityCalls = 0, renders = 0;
let changeJobs: React.Dispatch<React.SetStateAction<any[]>>, changeContracts: React.Dispatch<React.SetStateAction<any[]>>, changeUid: (uid: string) => void;
const check = async (id: string) => {
  integrityCalls++;
  await new Promise(resolve => setTimeout(resolve, 2));
  window.dispatchEvent(new CustomEvent("nvu-operation-integrity-checked", { detail: { jobId: id, progress: 6, status: "active" } }));
};
function IntegrityHarness() {
  renders++;
  const [uid, setUid] = useState("audit-user");
  const [jobs, setJobs] = useState([{ id: "job-a", driverId: "audit-user", contractId: "contract-a", companyId: "company-a", progress: 6, status: "active" }]);
  const [contracts, setContracts] = useState([{ id: "contract-a", totalDeliveries: 10 }]);
  changeJobs = setJobs; changeContracts = setContracts; changeUid = setUid;
  useEffect(() => {
    const update = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      setJobs(current => applyAuthoritativeJobProjection(current, detail.jobId, detail.progress, detail.status));
    };
    window.addEventListener("nvu-operation-integrity-checked", update);
    return () => window.removeEventListener("nvu-operation-integrity-checked", update);
  }, []);
  useInitialOperationIntegrity({ uid, enabled: true, jobs, contracts, check });
  return React.createElement("p", null, jobs[0]?.progress);
}
await act(async () => root.render(React.createElement(IntegrityHarness)));
for (let index = 0; index < 20; index++) await tick();
assert.equal(integrityCalls, 1, "an identical response must not cause another server audit");
const stableRenderCount = renders;
for (let index = 0; index < 20; index++) await act(async () => {
  window.dispatchEvent(new CustomEvent("nvu-operation-integrity-checked", { detail: { jobId: "job-a", progress: 6, status: "active" } }));
});
assert.equal(renders, stableRenderCount, "identical responses do not render the operational tree again");
const identicalResponseExtraRenders = renders - stableRenderCount;
await act(async () => changeJobs(current => current.map(job => ({ ...job, progress: 7 }))));
await tick(); assert.equal(integrityCalls, 1, "progress projections do not trigger full-history queries");
await act(async () => changeContracts(current => current.map(contract => ({ ...contract, name: "Nome atualizado" }))));
await tick(); assert.equal(integrityCalls, 1, "unrelated contract snapshots do not trigger audits");
await act(async () => changeContracts(current => current.map(contract => ({ ...contract, totalDeliveries: 11 }))));
await tick(); assert.equal(integrityCalls, 2, "a changed operation total must be checked");
await act(async () => window.dispatchEvent(new Event("online")));
await tick(); assert.equal(integrityCalls, 3, "online resume still verifies the server state");
await act(async () => changeUid("other-user"));
await tick(); assert.equal(integrityCalls, 3, "previous account operations are not audited for another UID");
await act(async () => changeJobs(current => current.map(job => ({ ...job, driverId: "other-user" }))));
await tick(); assert.equal(integrityCalls, 4, "the new account's own operation is checked");
await act(async () => root.unmount());
const jobs = [{ id: "j", progress: 6, status: "active" }];
assert.equal(applyAuthoritativeJobProjection(jobs, "j", 6, "active"), jobs);
assert.equal(applyAuthoritativeJobProjection(jobs, "missing", 5), jobs);
assert.equal(applyAuthoritativeJobProjection(jobs, "j", NaN), jobs);
assert.equal(applyAuthoritativeJobProjection(jobs, "j", 6, "awaiting_completion")[0].status, "awaiting_completion");

root = createRoot(document.getElementById("root")!);
const effects = new Set<string>();
let showSecond: (value: boolean) => void, finishLoading: (value: { default: () => React.ReactNode }) => void;
let changeDraft: (value: string) => void;
function FirstPanel() {
  const [draft, setDraft] = useState("original"); changeDraft = setDraft;
  useEffect(() => { effects.add("first"); return () => { effects.delete("first"); }; }, []);
  return React.createElement("input", { id: "draft", value: draft, readOnly: true });
}
const SecondPanel = lazy(() => new Promise(resolve => { finishLoading = resolve; }));
function PanelsHarness() {
  const [second, setSecond] = useState(false); showSecond = setSecond;
  return React.createElement(React.Fragment, null,
    React.createElement(RetainedPanel, { active: !second }, React.createElement(FirstPanel)),
    second && React.createElement(RetainedPanel, { active: true }, React.createElement(React.Suspense, { fallback: React.createElement(PanelLoading) }, React.createElement(SecondPanel))),
  );
}
await act(async () => root.render(React.createElement(React.Suspense, { fallback: React.createElement(PanelLoading) }, React.createElement(PanelsHarness))));
assert.deepEqual([...effects], ["first"]);
await act(async () => changeDraft("rascunho preservado"));
await act(async () => showSecond(true));
assert.equal(effects.size, 0, "hidden panel effects are disconnected");
assert.match(document.querySelector('[data-nvu-panel-loading]')?.textContent || "", /Abrindo conteúdo/);
await act(async () => finishLoading({ default: () => React.createElement("p", null, "Segundo painel pronto") }));
assert.match(document.querySelector('[data-nvu-panel-active="true"]')?.textContent || "", /Segundo painel pronto/);
await act(async () => showSecond(false));
assert.deepEqual([...effects], ["first"]);
assert.equal((document.getElementById("draft") as HTMLInputElement).value, "rascunho preservado", "draft survives hiding/reopening the panel");
await act(async () => root.unmount());

root = createRoot(document.getElementById("root")!);
Object.defineProperty(dom.window.navigator, "onLine", { value: false, configurable: true });
let posterReads = 0;
const originalGetItem = dom.window.Storage.prototype.getItem;
dom.window.Storage.prototype.getItem = function(key: string) {
  if (key.startsWith("nvu-vehicle-photo-poster:")) posterReads++;
  return originalGetItem.call(this, key);
};
function PhotoHarness({ update }: { update: number }) {
  useVehiclePhoto({ userId: "local-user", simulatorId: "gto", vehicleId: "scania-g" }, "company-a", true);
  return React.createElement("p", null, update);
}
for (let update = 0; update < 21; update++) await act(async () => root.render(React.createElement(PhotoHarness, { update })));
assert.equal(posterReads, 1, "first-paint localStorage poster is parsed once per scope");
await act(async () => root.unmount());
dom.window.Storage.prototype.getItem = originalGetItem;
dom.window.close();
console.log(JSON.stringify({ result: "PASS", identicalResponseAuditCalls: 1, repeatedIdenticalResponseExtraRenders: identicalResponseExtraRenders,
  posterReadsFor21Renders: posterReads, hiddenPanelActiveEffects: 0, draftPreserved: true, lazyPanelVisibleFallback: true,
  validated: ["changed totals", "online resume", "account isolation", "real projection references", "React Activity lifecycle"] }, null, 2));
