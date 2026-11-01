import "../../src/index.css";
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { MultiSelectField } from "../../src/components/ui/MultiSelectField";
import { CompanySimulatorsSection } from "../../src/components/admin/CompanySimulatorsSection";

// The real multi-select field and the "Simuladores da empresa" section, with the real stylesheet and a scripted onAdd.
const options = ["TOE 3", "WBDS", "GTO", "ATS", "ETS 2", "WTDS", "PBS"].map(label => ({ value: label.toLowerCase().replace(/\s+/g, "-"), label }));
const state: any = (window as any).qaMulti = { added: [] as string[][], failNext: false, canAdd: true, delay: 40 };
function App() {
  const [values, setValues] = useState<string[]>([]);
  const [canAdd, setCanAdd] = useState(true);
  state.setCanAdd = setCanAdd;
  return <main className="mx-auto max-w-md space-y-6 p-4">
    <MultiSelectField title="Selecionar simuladores" placeholder="Selecione um ou mais…" options={options} values={values} onChange={setValues} />
    <p data-testid="values">{values.join(",")}</p>
    <CompanySimulatorsSection rows={[{ companyId: "a", label: "GTO", current: true }, { companyId: "b", label: "ATS", current: false }]}
      addable={[{ value: "ets-2", label: "ETS 2" }, { value: "wtds", label: "WTDS" }, { value: "pbs", label: "PBS" }]} canAdd={canAdd}
      onAdd={async ids => {
        state.added.push(ids);
        await new Promise(resolve => setTimeout(resolve, state.delay));
        if (state.failNext) { state.failNext = false; throw new Error("Somente o proprietário da empresa pode fazer isso."); }
        return "ok";
      }} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<App />);
