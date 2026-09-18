/**
 * Resolves photos for recruitment applications without mixing in an
 * authentication provider's avatar by accident.
 *
 * Applications created by older versions used a few different field names.
 * The application record is always preferred; a user's canonical
 * `profilePhotoURL` is used only as a compatibility fallback.
 */
import { isCompanyRegistration } from "./registrationImages";

export type RecruitmentPhotoRecord =
  | object
  | null
  | undefined;

const APPLICATION_PHOTO_FIELDS = [
  "applicationPhotoURL",
  "applicationPhotoUrl",
  "applicationPhoto",
  "candidatePhotoURL",
  "candidatePhotoUrl",
  "photoURL",
  "photoUrl",
  "photo",
  "imageUrl",
  "profileImage",
] as const;

const PROFILE_PHOTO_FIELDS = [
  "profilePhotoURL",
  "profilePhotoUrl",
  "profileImage",
  "imageUrl",
] as const;

const PLACEHOLDER_PHOTO_HOSTS = new Set([
  "ui-profilephotourls.com",
  "i.prprofilephotourl.cc",
]);

const asRecord = (value: RecruitmentPhotoRecord): Record<string, unknown> =>
  value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};

const normalizePhotoValue = (value: unknown): string => {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  if (!normalized) return "";

  // HTTP URLs and data/blob URLs can be rendered directly by an <img>.
  if (
    normalized.startsWith("https://") ||
    normalized.startsWith("http://") ||
    normalized.startsWith("data:image/") ||
    normalized.startsWith("blob:")
  ) {
    if (normalized.startsWith("http")) {
      try {
        if (PLACEHOLDER_PHOTO_HOSTS.has(new URL(normalized).hostname.toLowerCase())) {
          return "";
        }
      } catch {
        return "";
      }
    }
    return normalized;
  }

  return "";
};

const readFields = (
  record: RecruitmentPhotoRecord,
  fields: readonly string[],
): string[] => {
  const source = asRecord(record);
  return fields
    .map((field) => source[field])
    .map(normalizePhotoValue)
    .filter(Boolean);
};

/** Returns every direct image candidate, preserving precedence and removing duplicates. */
export const getRecruitmentPhotoCandidates = (
  application: RecruitmentPhotoRecord,
  profile?: RecruitmentPhotoRecord,
): string[] => {
  // A company registration may contain a legacy `photoURL` logo and an owner
  // photo, but it is not a driver candidate. Never surface either image in RH.
  if (isCompanyRegistration(application)) return [];
  return Array.from(
    new Set([
      ...readFields(application, APPLICATION_PHOTO_FIELDS),
      ...readFields(profile, PROFILE_PHOTO_FIELDS),
    ]),
  );
};

/** Returns the first direct image URL appropriate for the application. */
export const resolveRecruitmentPhoto = (
  application: RecruitmentPhotoRecord,
  profile?: RecruitmentPhotoRecord,
): string => getRecruitmentPhotoCandidates(application, profile)[0] || "";

/** Storage paths are resolved separately because they need Firebase Storage. */
export const getRecruitmentPhotoStorageCandidates = (
  application: RecruitmentPhotoRecord,
  profile?: RecruitmentPhotoRecord,
): string[] => {
  if (isCompanyRegistration(application)) return [];
  const source = [
    ...APPLICATION_PHOTO_FIELDS.map((field) => asRecord(application)[field]),
    ...PROFILE_PHOTO_FIELDS.map((field) => asRecord(profile)[field]),
  ];

  return Array.from(
    new Set(
      source.filter((value): value is string => {
        if (typeof value !== "string") return false;
        const normalized = value.trim();
        return (
          normalized.startsWith("gs://") ||
          normalized.startsWith("empresas/")
        );
      }),
    ),
  );
};

export const getRecruitmentInitials = (name: string): string => {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (parts.length === 0) return "?";
  return parts.map((part) => part[0]?.toUpperCase() || "").join("");
};
