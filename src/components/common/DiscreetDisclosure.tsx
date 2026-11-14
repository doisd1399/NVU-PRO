import React, { useId, useState } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";

/** Lazily open an entire section, retaining its state after the first visit. */
export function DiscreetDisclosure({ title, summary, icon: Icon, children, className, testId }: {
  title: string;
  summary?: React.ReactNode;
  icon: LucideIcon;
  children: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [visited, setVisited] = useState(false);
  return (
    <section className={cn("nvu-driver-disclosure", className)} data-testid={testId}>
      <button type="button" id={`${id}-toggle`} className="nvu-driver-disclosure-toggle"
        aria-expanded={open} aria-controls={`${id}-content`}
        onClick={() => { setVisited(true); setOpen(value => !value); }}>
        <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
        <span className="nvu-driver-disclosure-title">{title}</span>
        {summary && <span className="nvu-driver-disclosure-summary">{summary}</span>}
        <ChevronDown size={17} aria-hidden="true" className={open ? "rotate-180" : ""} />
      </button>
      <div id={`${id}-content`} role="region" aria-labelledby={`${id}-toggle`} hidden={!open}>
        {visited && <div className="nvu-driver-disclosure-content">{children}</div>}
      </div>
    </section>
  );
}
