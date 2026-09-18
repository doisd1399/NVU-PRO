export type RegistrationImageRecord = unknown;

/**
 * Image fields changed names over the lifetime of the registration flow. Keep
 * source validation in one place so malformed values are not copied into an
 * approved company or user profile.
 */
export const isDirectImageSource = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  return (
    normalized.startsWith("data:image/") ||
    normalized.startsWith("https://") ||
    normalized.startsWith("http://")
  );
};

/** Firebase Storage references are not directly renderable by an <img>. */
export const isStorageImageSource = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  return (
    normalized.startsWith("gs://") ||
    normalized.startsWith("empresas/") ||
    normalized.startsWith("company_registrations/") ||
    normalized.startsWith("company-registration/")
  );
};

export const normalizeImageSource = (value: unknown): string => {
  if (!isDirectImageSource(value) && !isStorageImageSource(value)) return "";
  return String(value).trim();
};

const firstImageSource = (values: unknown[]): string => {
  for (const value of values) {
    const normalized = normalizeImageSource(value);
    if (normalized) return normalized;
  }
  return "";
};

const asRecord = (value: RegistrationImageRecord): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

/**
 * A legacy company registration stored its logo in `photoURL`. That alias is
 * accepted only for company records; using it for every registration would
 * turn a driver's photo into a company logo.
 */
export const isCompanyRegistration = (registration: RegistrationImageRecord) => {
  const source = asRecord(registration);
  const normalizedType = String(
    source.type || source.registrationType || source.kind || "",
  )
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, "_");
  const hasCompanyIdentity =
    [source.companyName, source.nomeEmpresa, source.fleetName].some(
      (value) => typeof value === "string" && value.trim().length > 0,
    );
  const hasOwnerOrTaxIdentity =
    [source.cnpj, source.CNPJ, source.ownerName, source.nomeProprietario].some(
      (value) => typeof value === "string" && value.trim().length > 0,
    );
  return (
    normalizedType === "company_registration" ||
    normalizedType === "companyregistration" ||
    normalizedType === "empresa_registration" ||
    normalizedType === "cadastro_empresa" ||
    (hasCompanyIdentity && hasOwnerOrTaxIdentity)
  );
};

export const resolveRegistrationCompanyLogo = (
  registration: RegistrationImageRecord,
): string => {
  const source = asRecord(registration);
  return firstImageSource([
    source.companyLogoURL,
    source.companyLogoUrl,
    source.company_logo_url,
    source.logoUrl,
    source.logoURL,
    source.logo_url,
    source.companyLogo,
    source.logo,
    source.logoEmpresa,
    source.logo_empresa,
    source.companyLogoStoragePath,
    source.logoStoragePath,
    source.company_logo_storage_path,
    source.logo_storage_path,
    ...(isCompanyRegistration(registration)
      ? [source.photoURL, source.photoUrl]
      : []),
  ]);
};

export const resolveRegistrationOwnerPhoto = (
  registration: RegistrationImageRecord,
): string => {
  const source = asRecord(registration);
  const explicitOwnerPhoto = [
    source.ownerPhotoUrl,
    source.ownerPhotoURL,
    source.owner_photo_url,
    source.ownerPhoto,
    source.owner_photo,
    source.profilePhotoURL,
    source.profilePhotoUrl,
    source.applicationPhotoURL,
    source.applicationPhotoUrl,
    source.fotoProprietario,
    source.ownerPhotoStoragePath,
    source.profilePhotoStoragePath,
    source.owner_photo_storage_path,
    source.profile_photo_storage_path,
  ];

  // `photoURL` belonged to the logo in the old company-registration schema.
  // It remains a candidate for non-company applications for compatibility with
  // the driver recruitment flow, but never for a company registration.
  if (!isCompanyRegistration(registration)) {
    explicitOwnerPhoto.push(source.photoURL, source.photoUrl);
  }

  return firstImageSource(explicitOwnerPhoto);
};

export const getRegistrationImageStorageCandidates = (
  registration: RegistrationImageRecord,
): { companyLogo: string; ownerPhoto: string } => {
  const source = asRecord(registration);
  const companyLogo = resolveRegistrationCompanyLogo(source);
  const ownerPhoto = resolveRegistrationOwnerPhoto(source);
  const explicitCompanyLogoPath = firstImageSource([
    source.companyLogoStoragePath,
    source.logoStoragePath,
    source.company_logo_storage_path,
    source.logo_storage_path,
  ]);
  const explicitOwnerPhotoPath = firstImageSource([
    source.ownerPhotoStoragePath,
    source.profilePhotoStoragePath,
    source.owner_photo_storage_path,
    source.profile_photo_storage_path,
  ]);
  return {
    companyLogo: isStorageImageSource(explicitCompanyLogoPath)
      ? explicitCompanyLogoPath
      : isStorageImageSource(companyLogo)
        ? companyLogo
        : "",
    ownerPhoto: isStorageImageSource(explicitOwnerPhotoPath)
      ? explicitOwnerPhotoPath
      : isStorageImageSource(ownerPhoto)
        ? ownerPhoto
        : "",
  };
};

export const normalizeRegistrationImages = <T extends Record<string, unknown>>(
  registration: T,
): T & { companyLogoURL: string; ownerPhotoUrl: string } => ({
  ...registration,
  companyLogoURL: resolveRegistrationCompanyLogo(registration),
  ownerPhotoUrl: resolveRegistrationOwnerPhoto(registration),
});
