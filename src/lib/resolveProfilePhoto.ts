import { driverDisplayIdentity } from "./driverDisplayIdentity";
export function resolveProfilePhoto(profile: any): string {
  return driverDisplayIdentity(profile).profilePhotoURL;
}
