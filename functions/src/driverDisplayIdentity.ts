type RecordLike = Record<string, any> | null | undefined;
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const first = (...values: unknown[]) => values.map(text).find(Boolean) || "";

/** Display metadata only. Authentication and membership always use the UID. */
export function driverDisplayIdentity(profile: RecordLike, application?: RecordLike) {
  const user = profile || {};
  const applicationMatches = application && application.type !== "company_registration" &&
    application.status === "approved" && application.isCurrent !== false &&
    !application.accessRevokedAt && !application.accessRevokedReason &&
    text(application.userId) === text(user.id || user.userId || user.uid) &&
    (!user.approvedIdentityApplicationId || application.id === user.approvedIdentityApplicationId);
  const form = applicationMatches ? application : {};
  const currentName = user.profileNameSource === "user_edit" || user.approvedIdentityVersion === 2;
  const name = (currentName ? first(user.name, form.fullName, user.approvedIdentityName) :
    first(form.fullName, user.approvedIdentityName, user.fullName, user.registeredName, user.name)) || "Motorista";
  const editedPhoto = user.profilePhotoSource === "user_edit";
  const currentPhoto = editedPhoto || user.approvedIdentityVersion === 2;
  const photoCandidates = currentPhoto
    ? [user.profilePhotoURL, user.profilePhotoUrl, form.applicationPhotoURL, user.approvedIdentityPhotoURL,
      user.applicationPhotoURL, user.ownerPhotoUrl, user.ownerPhotoURL, user.avatar, user.profileImage, user.imageUrl, user.photo]
    : [form.applicationPhotoURL, user.approvedIdentityPhotoURL, user.applicationPhotoURL,
      user.profilePhotoURL, user.profilePhotoUrl, user.ownerPhotoUrl, user.ownerPhotoURL,
      user.avatar, user.profileImage, user.imageUrl, user.photo, user.photoURL, user.photoUrl];
  // An explicitly removed photo stays removed. Provider-only avatars are never
  // promoted to NVU profile photos, including old copies in profilePhotoURL.
  const profilePhotoURL = editedPhoto ? text(user.profilePhotoURL) : photoCandidates.map(text).find(value => {
    if (!value || value === text(user.authPhotoURL) || value === text(user.googlePhotoURL)) return false;
    if (value.startsWith("data:image/") || value.startsWith("blob:")) return true;
    try {
      const url = new URL(value);
      return ["https:", "http:"].includes(url.protocol) &&
        !/(^|\.)(googleusercontent\.com|ggpht\.com)$/i.test(url.hostname);
    } catch { return false; }
  }) || "";
  return { name, profilePhotoURL };
}
