type Data = Record<string, any>;
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";

/** A new approval adopts the submitted identity. Replaying/repairing the same
 * application preserves later profile edits and never imports Google identity. */
export function recruitmentIdentityPatch(user: Data, application: Data, applicationId: string, now: unknown): Data {
  const sameApplication = user.approvedIdentityApplicationId === applicationId;
  const migrated = user.approvedIdentityVersion === 2;
  const adoptName = !sameApplication || (!migrated && user.profileNameSource !== "user_edit");
  const adoptPhoto = !sameApplication || (!migrated && user.profilePhotoSource !== "user_edit" && user.profileNameSource !== "user_edit");
  const name = text(application.fullName), photo = text(application.applicationPhotoURL);
  return {
    approvedIdentityApplicationId: applicationId,
    approvedIdentityName: name,
    ...(photo ? { approvedIdentityPhotoURL: photo } : {}),
    approvedIdentityVersion: 2,
    ...(adoptName && name ? { name, profileNameSource: "recruitment_application", profileNameUpdatedAt: now } : {}),
    ...(adoptPhoto && photo ? { profilePhotoURL: photo, profilePhotoSource: "recruitment_application", profilePhotoUpdatedAt: now } : {}),
    ...(!sameApplication && text(application.whatsapp) ? { whatsapp: text(application.whatsapp) } : {}),
  };
}
