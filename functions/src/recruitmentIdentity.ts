type Data = Record<string, any>;
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";

/** A new approval adopts the submitted identity unless the driver already edited that field by hand: what the driver
 * chose in the profile is kept and the form only fills what was never edited (or is empty). Replaying/repairing the
 * same application preserves later profile edits and never imports Google identity. */
export function recruitmentIdentityPatch(user: Data, application: Data, applicationId: string, now: unknown): Data {
  const sameApplication = user.approvedIdentityApplicationId === applicationId;
  const migrated = user.approvedIdentityVersion === 2;
  const editedName = user.profileNameSource === "user_edit" && Boolean(text(user.name));
  const editedPhoto = user.profilePhotoSource === "user_edit" && Boolean(text(user.profilePhotoURL));
  const adoptName = !sameApplication ? !editedName : (!migrated && user.profileNameSource !== "user_edit");
  const adoptPhoto = !sameApplication ? !editedPhoto : (!migrated && user.profilePhotoSource !== "user_edit" && user.profileNameSource !== "user_edit");
  const name = text(application.fullName), photo = text(application.applicationPhotoURL);
  return {
    approvedIdentityApplicationId: applicationId,
    approvedIdentityName: name,
    ...(photo ? { approvedIdentityPhotoURL: photo } : {}),
    approvedIdentityVersion: 2,
    ...(adoptName && name ? { name, profileNameSource: "recruitment_application", profileNameUpdatedAt: now } : {}),
    ...(adoptPhoto && photo ? { profilePhotoURL: photo, profilePhotoSource: "recruitment_application", profilePhotoUpdatedAt: now } : {}),
    ...(!sameApplication && text(application.whatsapp) && !text(user.whatsapp) ? { whatsapp: text(application.whatsapp) } : {}),
  };
}
