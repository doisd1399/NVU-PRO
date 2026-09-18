import type {
  CompanyMember,
  CompanyProfile,
  Role,
  Simulator,
  User,
} from "../context/AppContext";
import { resolveMembershipRoles } from "../lib/membershipRoles";
import {
  resolveRegisteredSimulatorId,
  resolveSimulatorDisplayLabel,
} from "../lib/simulatorOptions";
import { resolveSimulatorId } from "../lib/resolveSimulator";

export type ProfileIndexStatus = "resolving" | "ready" | "empty" | "error";

export type ProfileIndexProfile = {
  membershipId: string;
  role: Role;
  companyId: string;
  simulatorId?: string;
  simulatorName?: string;
  companyName: string;
  displayName: string;
  destination: "/admin/fleet" | "/driver/profile";
  valid: boolean;
};

export type ActiveProfileContext = Pick<
  ProfileIndexProfile,
  | "membershipId"
  | "role"
  | "companyId"
  | "simulatorId"
  | "simulatorName"
  | "companyName"
  | "destination"
>;

export type ProfileIndex = {
  uid: string;
  status: ProfileIndexStatus;
  errorCode?: "PROFILE_CONTEXT_UNRESOLVED";
  profiles: ProfileIndexProfile[];
  invalidProfiles: ProfileIndexProfile[];
};

export type ProfileIndexInput = {
  uid?: string | null;
  memberships: CompanyMember[];
  membershipsLoaded: boolean;
  /** A UID-scoped local snapshot may build the visual selector before server confirmation. */
  membershipsHydrated?: boolean;
  companies: CompanyProfile[];
  simulators: Simulator[];
  currentUser?: User | null;
};

const normalize = (value: unknown): string => String(value || "").trim();

const simulatorReference = (source?: Record<string, unknown> | null): boolean => {
  if (!source) return false;
  return Boolean(
    normalize(source.simulatorId) ||
      normalize(source.simuladorId) ||
      normalize(source.simulatorName) ||
      normalize(source.simuladorNome) ||
      normalize(source.simulator),
  );
};

const roleDestination = (role: Role): ProfileIndexProfile["destination"] =>
  role === "admin" ? "/admin/fleet" : "/driver/profile";

const profileSort = (left: ProfileIndexProfile, right: ProfileIndexProfile) => {
  const companyOrder = left.companyName.localeCompare(right.companyName, "pt-BR");
  if (companyOrder !== 0) return companyOrder;
  if (left.role !== right.role) return left.role === "admin" ? -1 : 1;
  return left.membershipId.localeCompare(right.membershipId);
};

/**
 * Resolves the minimum canonical data needed before the profile selector can
 * become interactive. It never reads Firestore, refreshes auth, starts a
 * listener, or performs navigation. Cached memberships are not enough to mark
 * the index ready: the current generation must have a canonical snapshot.
 */
export function buildProfileIndex(input: ProfileIndexInput): ProfileIndex {
  const uid = normalize(input.uid);
  const visualSnapshotReady = Boolean(input.membershipsHydrated);
  if (!uid || (!input.membershipsLoaded && !visualSnapshotReady)) {
    return { uid, status: "resolving", profiles: [], invalidProfiles: [] };
  }

  const companiesById = new Map(
    input.companies
      .filter((company) => normalize(company.id))
      .map((company) => [normalize(company.id), company] as const),
  );

  const profiles: ProfileIndexProfile[] = [];
  const seen = new Set<string>();

  input.memberships
    .filter(
      (membership) =>
        membership.status === "active" &&
        normalize(membership.userId) === uid &&
        normalize(membership.companyId),
    )
    .forEach((membership) => {
      const companyId = normalize(membership.companyId);
      const company = companiesById.get(companyId);
      const companyName =
        normalize(company?.companyName) ||
        normalize((membership as any).companyName) ||
        "Empresa vinculada";
      const registeredSimulatorId = company
        ? resolveRegisteredSimulatorId(company, input.simulators)
        : "";
      // During local hydration the company snapshot is the last known valid
      // simulator identity. It may be older than the global catalog, but it is
      // enough to paint the selector/profile. The canonical path remains
      // strict and still requires the current simulator listener.
      const hydratedSimulatorId =
        visualSnapshotReady && company
          ? resolveSimulatorId(company, [], [company])
          : "";
      const resolvedSimulatorId = registeredSimulatorId || hydratedSimulatorId;
      const simulatorName = company && resolvedSimulatorId
        ? resolveSimulatorDisplayLabel(company, input.simulators, input.companies)
        : "";
      const simulatorRequired =
        simulatorReference(company) || simulatorReference(membership as any);
      const roles = new Set(resolveMembershipRoles(membership, input.currentUser));

      if (
        company &&
        (company.ownerId === uid || company.userId === uid)
      ) {
        roles.add("admin");
      }

      roles.forEach((role) => {
        const membershipId = normalize(membership.id) || `${companyId}:${role}`;
        const key = `${membershipId}:${role}`;
        if (seen.has(key)) return;
        seen.add(key);

        const valid = Boolean(
          company &&
            companyId &&
            roleDestination(role) &&
            (!simulatorRequired || Boolean(resolvedSimulatorId)),
        );
        profiles.push({
          membershipId,
          role,
          companyId,
          ...(resolvedSimulatorId && { simulatorId: resolvedSimulatorId }),
          ...(simulatorName && { simulatorName }),
          companyName,
          displayName: simulatorName
            ? `${companyName} - ${simulatorName}`
            : companyName,
          destination: roleDestination(role),
          valid,
        });
      });
    });

  profiles.sort(profileSort);
  const validProfiles = profiles.filter((profile) => profile.valid);
  const invalidProfiles = profiles.filter((profile) => !profile.valid);

  if (validProfiles.length === 0) {
    return {
      uid,
      status: profiles.length > 0 ? "error" : "empty",
      ...(profiles.length > 0 && { errorCode: "PROFILE_CONTEXT_UNRESOLVED" }),
      profiles: [],
      invalidProfiles,
    };
  }

  return {
    uid,
    status: "ready",
    profiles: validProfiles,
    invalidProfiles,
  };
}

export function toActiveProfileContext(
  profile: ProfileIndexProfile,
): ActiveProfileContext {
  return {
    membershipId: profile.membershipId,
    role: profile.role,
    companyId: profile.companyId,
    ...(profile.simulatorId && { simulatorId: profile.simulatorId }),
    ...(profile.simulatorName && { simulatorName: profile.simulatorName }),
    companyName: profile.companyName,
    destination: profile.destination,
  };
}
