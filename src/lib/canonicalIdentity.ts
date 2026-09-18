export type IdentityApplication = {
  id?: string;
  status?: unknown;
  fullName?: unknown;
  name?: unknown;
  ownerName?: unknown;
  whatsapp?: unknown;
  applicationPhotoURL?: unknown;
  updatedAt?: unknown;
  createdAt?: unknown;
  dataHora?: unknown;
  submittedAt?: unknown;
};

const asNonEmptyString = (value: unknown): string => {
  if (typeof value !== "string") return "";
  return value.trim();
};

export const identityTimestampMs = (value: unknown): number => {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (
    value &&
    typeof value === "object" &&
    typeof (value as { toMillis?: unknown }).toMillis === "function"
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (
    value &&
    typeof value === "object" &&
    typeof (value as { seconds?: unknown }).seconds === "number"
  ) {
    return (value as { seconds: number }).seconds * 1000;
  }
  return 0;
};

const applicationTimestampMs = (application: IdentityApplication): number =>
  identityTimestampMs(
    application.updatedAt ??
      application.createdAt ??
      application.dataHora ??
      application.submittedAt,
  );

const applicationName = (application: IdentityApplication): string =>
  asNonEmptyString(
    application.fullName ?? application.ownerName ?? application.name,
  );

export const selectNewestApprovedApplication = (
  applications: IdentityApplication[],
): IdentityApplication | null =>
  [...applications]
    .filter(
      (application) =>
        String(application.status || "").trim().toLowerCase() === "approved" &&
        Boolean(applicationName(application)),
    )
    .sort(
      (left, right) =>
        applicationTimestampMs(right) - applicationTimestampMs(left),
    )[0] ?? null;

const isPlaceholderName = (value: string) =>
  ["usuário", "usuario", "motorista"].includes(value.toLocaleLowerCase("pt-BR"));

export const resolveCanonicalProfileName = ({
  approvedApplication,
  canonicalRecord,
  mergedRecord,
  googleDisplayName,
  email,
}: {
  approvedApplication?: IdentityApplication | null;
  canonicalRecord?: Record<string, unknown> | null;
  mergedRecord?: Record<string, unknown> | null;
  googleDisplayName?: string | null;
  email?: string | null;
}): string => {
  const candidates = [
    approvedApplication ? applicationName(approvedApplication) : "",
    canonicalRecord?.approvedIdentityName,
    canonicalRecord?.approvedFullName,
    canonicalRecord?.identityName,
    canonicalRecord?.name,
    mergedRecord?.name,
    googleDisplayName,
    email?.split("@")[0],
  ]
    .map(asNonEmptyString)
    .filter((candidate) => candidate && !isPlaceholderName(candidate));

  return candidates[0] || "Usuário";
};

export const approvedApplicationField = (
  application: IdentityApplication | null | undefined,
  field: "whatsapp" | "applicationPhotoURL",
): string => asNonEmptyString(application?.[field]);
