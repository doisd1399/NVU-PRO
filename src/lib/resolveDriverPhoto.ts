import { driverDisplayIdentity } from "./driverDisplayIdentity";
export function resolveDriverPhoto(driver: any, user?: any): string {
  // An explicit profile-photo removal must not fall back to another avatar.
  if (driver?.profilePhotoSource === "user_edit") return driverDisplayIdentity(driver).profilePhotoURL;
  return driverDisplayIdentity(driver).profilePhotoURL || driverDisplayIdentity(user).profilePhotoURL;
}
