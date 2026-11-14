import React from "react";
import { Users } from "lucide-react";
import { StableImage } from "../common/StableImage";
import "../admin/AssignmentWorkspace.css";

export type DriverChoice = { id: string; name: string; photo: string };

/** Seletor de motoristas igual ao do "Encaminhar trabalho": título, contagem, "Selecionar todos" e cartões com caixa de seleção e foto. */
export function DriverMultiSelect({ drivers, selected, onChange, disabled, ready = true, help = "Quem recebe a oferta." }: {
  drivers: DriverChoice[]; selected: string[]; onChange: (ids: string[]) => void; disabled?: boolean; ready?: boolean; help?: string;
}) {
  const allSelected = drivers.length > 0 && drivers.every(driver => selected.includes(driver.id));
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter(item => item !== id) : [...selected, id]);
  return <div className="nvu-assignment-theme"><section className="nvu-assignment-drivers" aria-labelledby="reward-drivers-label" style={{ borderTop: 0, paddingTop: 4 }}>
    <div className="nvu-assignment-drivers-heading">
      <h2 id="reward-drivers-label"><Users size={23} strokeWidth={1.7} />Motoristas</h2>
      <span className="nvu-assignment-selection-count" role="status">{selected.length} {selected.length === 1 ? "selecionado" : "selecionados"}</span>
      <button type="button" className="nvu-assignment-text-action" onClick={() => onChange(allSelected ? [] : drivers.map(driver => driver.id))} disabled={!drivers.length || disabled}>{allSelected ? "Desmarcar todos" : "Selecionar todos"}</button>
    </div>
    <p className="nvu-assignment-help">{help}</p>
    <div className="nvu-assignment-driver-list">
      {drivers.map(driver => {
        const isSelected = selected.includes(driver.id);
        return <label key={driver.id} className={"nvu-assignment-driver" + (isSelected ? " is-selected" : "")}>
          <input type="checkbox" checked={isSelected} onChange={() => toggle(driver.id)} disabled={disabled} aria-label={"Selecionar " + driver.name} />
          <StableImage src={driver.photo} alt="" loading="lazy" decoding="async" wrapperClassName="nvu-assignment-avatar" className="object-cover" referrerPolicy="no-referrer"
            fallback={<span>{driver.name.substring(0, 2).toUpperCase()}</span>} />
          <span className="nvu-assignment-driver-copy"><strong>{driver.name}</strong><small>Motorista</small></span>
        </label>;
      })}
      {!drivers.length ? <p className="nvu-assignment-empty" role="status">{ready ? "Nenhum motorista ativo na empresa." : "Consultando os motoristas da empresa…"}</p> : null}
    </div>
  </section></div>;
}
