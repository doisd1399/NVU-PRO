import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { PrintFailureDiagnostic, usePrintFailureDiagnostic } from "../../src/components/PrintFailureDiagnostic";

function Form({ owner }: { owner: string }) {
  const diagnostic = usePrintFailureDiagnostic(owner);
  return <main>
    <button onClick={() => diagnostic.capture(Object.assign(new Error("OFFLINE_STORAGE_WRITE_FAILED token=private-test-secret https://example.test/private"), { code: "OFFLINE_STORAGE_WRITE_FAILED" }), "journal-write")}>Simular falha real de envio</button>
    <button onClick={diagnostic.clear}>Iniciar nova tentativa</button>
    <button onClick={diagnostic.clear}>Concluir lançamento</button>
    <PrintFailureDiagnostic text={diagnostic.text}/>
  </main>;
}
function App() {
  const [owner, setOwner] = useState("driver-a"), [revision, setRevision] = useState(0);
  return <><button onClick={() => setOwner(value => value === "driver-a" ? "driver-b" : "driver-a")}>Trocar conta</button>
    <button onClick={() => setRevision(value => value + 1)}>Reabrir formulário</button>
    <Form key={revision} owner={owner}/></>;
}
(window as any).qaPrint519 = { reads: 0, saved: [], copied: "" };
createRoot(document.getElementById("root")!).render(<App/>);
