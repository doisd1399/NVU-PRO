import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { vehiclePhotoKey } from "../src/lib/vehiclePhotoIdentity";

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://127.0.0.1/photo-test" });
for (const name of ["window", "document", "localStorage", "CustomEvent", "Event", "navigator", "Image"]) {
  Object.defineProperty(globalThis, name, { value: (dom.window as any)[name], configurable: true });
}
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const { putVehiclePhotoRecord, getVehiclePhotoRecord } = await import("../src/services/vehiclePhotoStore");
const { vehiclePhotoService } = await import("../src/services/vehiclePhotoService");
// Cloud transport is covered separately by the real Firestore Emulator test.
// DOM interactions use the real local store and hook; no live Firebase call is permitted.
vehiclePhotoService.load = (identity) => getVehiclePhotoRecord(identity);
const { useVehiclePhoto } = await import("../src/hooks/useVehiclePhoto");
const { GtoWorkModeDialog } = await import("../src/components/GtoWorkModeDialog");
const { VehiclePhotoThumbnail } = await import("../src/components/common/VehiclePhotoThumbnail");
const identity = { userId: "ui-photo-user", simulatorId: "gto", vehicleId: "scania-g", vehicleName: "Scania G" };
const photoA = "data:image/png;base64,c2Nhbmlh", photoB = "data:image/png;base64,aXZlY28=";
for (const [id, name, image] of [["scania-g", "Scania G", photoA], ["iveco", "Iveco S Way", photoB]]) {
  const scoped = { ...identity, vehicleId: id, vehicleName: name };
  await putVehiclePhotoRecord({ ...scoped, key: vehiclePhotoKey(scoped), companyId: "company-a", revision: id,
    imageDataUrl: image, posterDataUrl: image, contentType: "image/png", status: "pending", updatedAt: Date.now() });
}
let switchScope!: (next: typeof identity) => void;
const selections: string[] = [];
function App() {
  const [scope, setScope] = React.useState(identity), [open, setOpen] = React.useState(false);
  switchScope = setScope;
  const photo = useVehiclePhoto(scope, "company-a");
  return React.createElement(React.Fragment, null,
    React.createElement("button", { id: "open", onClick: () => setOpen(true) }, "Iniciar trabalho"),
    photo.src && React.createElement("img", { src: photo.src, "data-testid": "main-photo" }),
    React.createElement(VehiclePhotoThumbnail, { ...scope, companyId: "company-a" }),
    React.createElement(GtoWorkModeDialog, { open, variant: "gto", vehiclePhoto: photo.src, vehicleName: scope.vehicleName,
      vehiclePhotoPending: photo.pending, onClose: () => setOpen(false), onSelect: (mode) => { selections.push(mode); } }),
  );
}
let root = createRoot(document.getElementById("root")!);
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
const click = async (element: Element) => { await act(async () => { (element as HTMLElement).click(); }); await flush(); };
const dialogImage = () => document.querySelector('[data-testid="work-mode-vehicle-card"] img') as HTMLImageElement | null;
await act(async () => { root.render(React.createElement(App)); }); await flush();
await click(document.getElementById("open")!);
assert.equal(dialogImage()?.src, photoA);
assert.equal((document.querySelector('[data-testid="main-photo"]') as HTMLImageElement).src, photoA);
const printButton = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("Modo print"))!;
assert.ok(dialogImage()!.compareDocumentPosition(printButton) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
assert.match(document.querySelector('[data-testid="work-mode-vehicle-card"]')!.textContent || "", /Scania G/);
await click(printButton); assert.deepEqual(selections, ["print"]);
await click(document.querySelector('button[aria-label="Fechar"]')!);
await click(document.getElementById("open")!); assert.equal(dialogImage()?.src, photoA);
await act(async () => { switchScope({ ...identity, vehicleId: "iveco", vehicleName: "Iveco S Way" }); }); await flush();
assert.equal(dialogImage()?.src, photoB);
await act(async () => { switchScope({ ...identity, simulatorId: "ets2" }); }); await flush();
assert.equal(dialogImage(), null);
await act(async () => { switchScope({ ...identity, userId: "another-user" }); }); await flush();
assert.equal(dialogImage(), null);
await act(async () => { root.unmount(); });
// Reopen in a fresh React root using only persisted IndexedDB bytes, with posters cleared.
localStorage.clear();
root = createRoot(document.getElementById("root")!);
await act(async () => { root.render(React.createElement(App)); }); await flush();
await click(document.getElementById("open")!);
assert.equal(dialogImage()?.src, photoA);
assert.equal(document.querySelector('img[alt="Foto de Scania G"]')?.getAttribute("src"), photoA);
await act(async () => { root.unmount(); });
dom.window.close();
console.log("PASS React DOM interactions: local photo above Print, shared card/thumbnail source, close/reopen, vehicle switch, simulator/account isolation and fresh-root offline rehydration.");
