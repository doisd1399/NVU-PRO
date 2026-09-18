export type OperationalRole = "admin" | "driver";

type MembershipLike = {
  companyId?: unknown;
  role?: unknown;
  roles?: unknown;
} | null | undefined;

const isOperationalRole = (value: unknown): value is OperationalRole =>
  value === "admin" || value === "driver";

const collectRoles = (value: unknown, target: Set<OperationalRole>) => {
  if (!Array.isArray(value)) return;
  value.forEach((role) => {
    if (isOperationalRole(role)) target.add(role);
  });
};

/**
 * Resolves the effective roles of a company membership while preserving
 * compatibility with legacy documents that used `role`, omitted `roles`, or
 * stored an empty/invalid roles array.
 *
 * A companyMembers document represents a driver relationship by default. This
 * mirrors the legacy NVU behavior and prevents the profile selector from
 * showing Motorista while the protected route rejects the same membership.
 */
export function resolveMembershipRoles(
  membership: MembershipLike,
  _user?: unknown,
): OperationalRole[] {
  const resolved = new Set<OperationalRole>();

  collectRoles(membership?.roles, resolved);
  if (isOperationalRole(membership?.role)) resolved.add(membership.role);

  // An active companyMembers document is the only authorization input. Legacy
  // user.role/companyId/memberships fields are intentionally not consulted:
  // they can outlive a removal or belong to another company. A roleless legacy
  // membership remains a driver link for backwards-compatible data shape only.
  if (resolved.has("admin")) resolved.add("driver");
  if (resolved.size === 0 && membership) resolved.add("driver");

  return Array.from(resolved);
}

export function membershipHasRole(
  membership: MembershipLike,
  role: OperationalRole,
  _user?: unknown,
): boolean {
  return resolveMembershipRoles(membership, _user).includes(role);
}
