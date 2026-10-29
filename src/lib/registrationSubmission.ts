/** Supports current ISO values and legacy Firestore Timestamp representations. */
export function registrationSubmittedDate(registration: any): Date | null {
  const value = registration?.submittedAt ?? registration?.createdAt;
  if (value === null || value === undefined || value === "") return null;
  try {
    const date = typeof value?.toDate === "function" ? value.toDate() :
      typeof value?.seconds === "number" ? new Date(value.seconds * 1000 + (value.nanoseconds || 0) / 1e6) :
      typeof value?._seconds === "number" ? new Date(value._seconds * 1000) :
      value instanceof Date ? value : new Date(value);
    return date instanceof Date && Number.isFinite(date.getTime()) ? date : null;
  } catch { return null; }
}

export function registrationSubmissionLabel(registration: any) {
  const date = registrationSubmittedDate(registration);
  if (!date) return "Data de envio não informada";
  const timeZone = "America/Sao_Paulo";
  return `Enviado em ${date.toLocaleDateString("pt-BR", { timeZone })} • ${date.toLocaleTimeString("pt-BR", { timeZone, hour: "2-digit", minute: "2-digit" })}`;
}
