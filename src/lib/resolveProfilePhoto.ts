export function resolveProfilePhoto(profile: any): string {
  return (
    profile?.profilePhotoURL ||
    profile?.photoURL ||
    profile?.photoUrl ||
    profile?.avatar ||
    profile?.ownerPhotoUrl ||
    profile?.profileImage ||
    profile?.imageUrl ||
    profile?.photo ||
    ""
  );
}
