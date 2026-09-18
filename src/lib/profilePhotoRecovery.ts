import { isCompanyRegistration } from "./registrationImages";

export type UserPhotoRecord = unknown;

const normalizePhotoSource = (value: unknown): string => {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  if (!normalized) return "";
  if (
    normalized.startsWith("data:image/") ||
    normalized.startsWith("https://") ||
    normalized.startsWith("http://")
  ) {
    return normalized;
  }
  return "";
};

/**
 * Resolves only person/profile image fields. Company logos are intentionally
 * excluded so an administrator logo can never replace the owner's photo.
 */
export const resolvePersistedUserProfilePhoto = (
  ...records: UserPhotoRecord[]
): string => {
  for (const record of records) {
    if (!record || typeof record !== "object") continue;
    const source = record as Record<string, unknown>;
    const candidates = [
      source.profilePhotoURL,
      source.profilePhotoUrl,
      source.ownerPhotoUrl,
      source.ownerPhotoURL,
      source.applicationPhotoURL,
      source.avatar,
      source.profileImage,
      source.imageUrl,
      source.photo,
    ];

    // Company registrations used `photoURL` for the company logo in the
    // legacy schema. Never copy that field into a person's profile photo.
    if (!isCompanyRegistration(source)) {
      candidates.push(source.photoURL, source.photoUrl);
    }

    for (const candidate of candidates) {
      const photo = normalizePhotoSource(candidate);
      if (photo) return photo;
    }
  }

  return "";
};

export const resolveApprovedCompanyOwnerPhoto = (
  registrations: UserPhotoRecord[],
): string => {
  const approved = registrations
    .filter((registration): registration is Record<string, unknown> => {
      if (!registration || typeof registration !== "object") return false;
      const source = registration as Record<string, unknown>;
      return (
        isCompanyRegistration(source) &&
        String(source.status || "").toLowerCase() === "approved"
      );
    })
    .sort((left, right) => {
      const leftTime = Date.parse(String(left.createdAt || "")) || 0;
      const rightTime = Date.parse(String(right.createdAt || "")) || 0;
      return rightTime - leftTime;
    });

  return resolvePersistedUserProfilePhoto(...approved);
};
