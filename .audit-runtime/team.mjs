// src/lib/membershipRoles.ts
var isOperationalRole = (value) => value === "admin" || value === "driver";
var collectRoles = (value, target) => {
  if (!Array.isArray(value)) return;
  value.forEach((role) => {
    if (isOperationalRole(role)) target.add(role);
  });
};
function resolveMembershipRoles(membership, _user) {
  const resolved = /* @__PURE__ */ new Set();
  collectRoles(membership?.roles, resolved);
  if (isOperationalRole(membership?.role)) resolved.add(membership.role);
  if (resolved.has("admin")) resolved.add("driver");
  if (resolved.size === 0 && membership) resolved.add("driver");
  return Array.from(resolved);
}

// src/lib/companyTeam.ts
function companyTeamRoles(userId, companyId, members, company) {
  if (!userId || !companyId) return [];
  if (company?.id === companyId && (company.ownerId === userId || company.userId === userId)) return ["admin", "driver"];
  const links = members.filter((row) => row.userId === userId && row.companyId === companyId);
  const active = links.find((row) => row.status === "active");
  return active ? resolveMembershipRoles(active) : [];
}
export {
  companyTeamRoles
};
