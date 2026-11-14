import "../../src/index.css";
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { MultiSelectField } from "../../src/components/ui/MultiSelectField";

// The real multi-select field with the real stylesheet.
const options = ["TOE 3", "WBDS", "GTO", "ATS", "ETS 2", "WTDS", "PBS"].map(label => ({ value: label.toLowerCase().replace(/\s+/g, "-"), label }));
function App() {
  const [values, setValues] = useState<string[]>([]);
  return <main className="mx-auto max-w-md space-y-6 p-4">
    <MultiSelectField title="Selecionar simuladores" placeholder="Selecione um ou mais…" options={options} values={values} onChange={setValues} />
    <p data-testid="values">{values.join(",")}</p>
  </main>;
}
createRoot(document.getElementById("root")!).render(<App />);
