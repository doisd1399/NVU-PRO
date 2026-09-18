import { getDownloadURL, ref } from "firebase/storage";
import { storage } from "./firebase";
import {
  getRegistrationImageStorageCandidates,
  isDirectImageSource,
  isStorageImageSource,
  normalizeImageSource,
  normalizeRegistrationImages,
} from "./registrationImages";

const storagePathFromSource = (source: string): string => {
  const normalized = source.trim();
  if (!normalized.startsWith("gs://")) return normalized;

  // A gs:// reference includes the bucket name, while Firebase Storage's
  // `ref` accepts the object path when the app already has the bucket config.
  const withoutScheme = normalized.slice("gs://".length);
  const separator = withoutScheme.indexOf("/");
  return separator >= 0 ? withoutScheme.slice(separator + 1) : "";
};

/**
 * Converts a persisted Storage path into a browser-renderable download URL.
 * Direct URLs/data URLs are returned unchanged. A failed lookup returns an
 * empty string so callers can show a recoverable "image unavailable" state.
 */
export const resolveRegistrationImageSource = async (
  value: unknown,
): Promise<string> => {
  const normalized = normalizeImageSource(value);
  if (!normalized) return "";
  if (isDirectImageSource(normalized)) return normalized;
  if (!isStorageImageSource(normalized)) return "";

  const path = storagePathFromSource(normalized);
  if (!path) return "";

  try {
    return await getDownloadURL(ref(storage, path));
  } catch (error) {
    console.warn("[RegistrationImages] Storage path could not be resolved", {
      path,
      error,
    });
    return "";
  }
};

/** Hydrates both company and owner images without changing legacy precedence. */
export const hydrateRegistrationImages = async <
  T extends Record<string, unknown>,
>(registration: T) => {
  const normalized = normalizeRegistrationImages(registration);
  const storageCandidates = getRegistrationImageStorageCandidates(normalized);
  const [companyLogo, ownerPhoto] = await Promise.all([
    resolveRegistrationImageSource(normalized.companyLogoURL),
    resolveRegistrationImageSource(normalized.ownerPhotoUrl),
  ]);

  return {
    ...normalized,
    companyLogoURL: companyLogo || (storageCandidates.companyLogo ? "" : normalized.companyLogoURL),
    ownerPhotoUrl: ownerPhoto || (storageCandidates.ownerPhoto ? "" : normalized.ownerPhotoUrl),
    ...(storageCandidates.companyLogo && {
      companyLogoStoragePath: storageCandidates.companyLogo,
    }),
    ...(storageCandidates.ownerPhoto && {
      ownerPhotoStoragePath: storageCandidates.ownerPhoto,
    }),
  };
};
