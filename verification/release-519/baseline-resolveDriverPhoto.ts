export function resolveDriverPhoto(driver:any, user?:any): string {
  return (
    driver?.profilePhotoURL ||
    driver?.photoURL ||
    driver?.photoUrl ||
    driver?.avatar ||
    driver?.profileImage ||
    driver?.imageUrl ||
    driver?.photo ||
    user?.profilePhotoURL ||
    user?.photoURL ||
    user?.photoUrl ||
    user?.avatar ||
    user?.profileImage ||
    user?.imageUrl ||
    user?.photo ||
    ""
  );
}
