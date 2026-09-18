import {
  Timestamp,
  collection,
  doc,
  runTransaction,
  serverTimestamp,
  type DocumentData,
} from "firebase/firestore";
import { auth, db } from "../lib/firebase";
import { buildNotificationPayload } from "./notificationService";
import {
  DRIVER_SUSPENSION_DURATION_OPTIONS,
  DRIVER_SUSPENSION_REASON_OPTIONS,
  TRIP_DELETION_REASON_OPTIONS,
  type DriverSuspensionDurationHours,
} from "../lib/driverSuspension";

export interface SuspensionInput {
  driverId: string;
  companyId: string;
  tripId?: string;
  durationHours: DriverSuspensionDurationHours;
  reasons: string[];
  message?: string;
}

export interface TripDeletionInput {
  tripId: string;
  driverId: string;
  companyId: string;
  tripNumber: string;
  tripDateLabel: string;
  tripValue: number;
  reasons: string[];
  suspension?: SuspensionInput | null;
}

function safeDocumentId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 1400);
}

function normalizeRequiredId(value: unknown, label: string) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label} não identificado.`);
  return normalized;
}

function normalizeReasons(
  values: string[],
  allowed: readonly string[],
  emptyMessage: string,
) {
  const unique = Array.from(
    new Set(values.map((value) => String(value || "").trim()).filter(Boolean)),
  );
  if (unique.length === 0) throw new Error(emptyMessage);
  if (unique.some((value) => !allowed.includes(value))) {
    throw new Error("Foi informado um motivo de moderação inválido.");
  }
  return unique;
}

function normalizeSuspensionInput(input: SuspensionInput): SuspensionInput {
  const durationHours = Number(input.durationHours) as DriverSuspensionDurationHours;
  if (!DRIVER_SUSPENSION_DURATION_OPTIONS.includes(durationHours)) {
    throw new Error("Selecione uma duração válida para a suspensão.");
  }

  return {
    ...input,
    driverId: normalizeRequiredId(input.driverId, "Motorista"),
    companyId: normalizeRequiredId(input.companyId, "Empresa"),
    tripId: String(input.tripId || "").trim() || undefined,
    durationHours,
    reasons: normalizeReasons(
      input.reasons,
      DRIVER_SUSPENSION_REASON_OPTIONS,
      "Selecione ao menos um motivo para a suspensão.",
    ),
    message: String(input.message || "").trim().slice(0, 500),
  };
}

function tripDriverId(data: DocumentData) {
  return String(data.driverId || data.motoristaId || data.criadoPor || "").trim();
}

function tripCompanyId(data: DocumentData) {
  return String(data.companyId || data.empresaId || "").trim();
}

function assertTripMatchesModeration(
  data: DocumentData,
  driverId: string,
  companyId: string,
) {
  const storedDriverId = tripDriverId(data);
  const storedCompanyId = tripCompanyId(data);
  if (!storedDriverId || storedDriverId !== driverId) {
    throw new Error("O motorista da viagem mudou. Atualize a página e tente novamente.");
  }
  if (!storedCompanyId || storedCompanyId !== companyId) {
    throw new Error("A empresa da viagem mudou. Atualize a página e tente novamente.");
  }
}

function buildSuspensionWrite(input: SuspensionInput, actorUserId: string) {
  const startsAt = Timestamp.now();
  const endsAt = Timestamp.fromMillis(
    startsAt.toMillis() + input.durationHours * 60 * 60 * 1000,
  );
  const message = String(input.message || "").trim();

  return {
    startsAt,
    endsAt,
    userUpdate: {
      isOnline: false,
      operationalSuspendedAt: startsAt,
      operationalSuspendedUntil: endsAt,
      operationalSuspensionDurationHours: input.durationHours,
      operationalSuspensionReasons: input.reasons,
      operationalSuspensionMessage: message,
      operationalSuspension: {
        startsAt,
        endsAt,
        durationHours: input.durationHours,
        reasons: input.reasons,
        message,
        companyId: input.companyId,
        tripId: input.tripId || "",
        createdBy: actorUserId,
      },
    },
  };
}

function buildSuspensionNotification(input: SuspensionInput, endsAt: Timestamp) {
  const reasonsText = input.reasons.join(", ");
  const optionalMessage = String(input.message || "").trim();
  const endLabel = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(endsAt.toDate());

  return buildNotificationPayload({
    userId: input.driverId,
    companyId: input.companyId,
    type: "DRIVER_SUSPENDED",
    targetProfile: "driver",
    title: "Atividades operacionais suspensas",
    message: `Suas atividades foram suspensas por ${input.durationHours} horas. Motivo: ${reasonsText}. Liberação automática em ${endLabel}.${optionalMessage ? ` Mensagem da administração: ${optionalMessage}` : ""}`,
    metadata: {
      durationHours: input.durationHours,
      reasons: input.reasons,
      message: optionalMessage,
      suspendedUntil: endsAt,
      tripId: input.tripId || null,
    },
    dedupeKey: `DRIVER_SUSPENDED_${input.tripId || "manual"}_${endsAt.seconds}`,
  });
}

export async function applyDriverSuspension(rawInput: SuspensionInput) {
  const actorUserId = auth.currentUser?.uid;
  if (!actorUserId) throw new Error("Sessão administrativa não autenticada.");

  const input = normalizeSuspensionInput(rawInput);
  const userRef = doc(db, "users", input.driverId);
  const tripRef = input.tripId
    ? doc(db, "historico_viagens", input.tripId)
    : null;
  const auditRef = doc(collection(db, "driver_suspension_audits"));
  const notificationRef = doc(
    db,
    "notifications",
    safeDocumentId(`${input.driverId}_suspension_${auditRef.id}`),
  );
  const write = buildSuspensionWrite(input, actorUserId);
  const notification = buildSuspensionNotification(input, write.endsAt);

  await runTransaction(db, async (transaction) => {
    const userSnapshot = await transaction.get(userRef);
    const tripSnapshot = tripRef ? await transaction.get(tripRef) : null;

    if (!userSnapshot.exists()) {
      throw new Error("Cadastro do motorista não encontrado.");
    }
    if (tripRef && (!tripSnapshot || !tripSnapshot.exists())) {
      throw new Error("A viagem usada como referência não está mais disponível.");
    }
    if (tripSnapshot?.exists()) {
      assertTripMatchesModeration(
        tripSnapshot.data(),
        input.driverId,
        input.companyId,
      );
    }

    transaction.update(userRef, write.userUpdate);
    transaction.set(notificationRef, notification);
    transaction.set(auditRef, {
      driverId: input.driverId,
      companyId: input.companyId,
      tripId: input.tripId || null,
      durationHours: input.durationHours,
      reasons: input.reasons,
      message: String(input.message || "").trim(),
      startsAt: write.startsAt,
      endsAt: write.endsAt,
      createdAt: serverTimestamp(),
      actorUserId,
      schemaVersion: 1,
    });
  });

  return { endsAt: write.endsAt.toDate() };
}

export async function deleteTripWithModeration(rawInput: TripDeletionInput) {
  const actorUserId = auth.currentUser?.uid;
  if (!actorUserId) throw new Error("Sessão administrativa não autenticada.");

  const input: TripDeletionInput = {
    ...rawInput,
    tripId: normalizeRequiredId(rawInput.tripId, "Viagem"),
    driverId: normalizeRequiredId(rawInput.driverId, "Motorista da viagem"),
    companyId: normalizeRequiredId(rawInput.companyId, "Empresa da viagem"),
    tripNumber: normalizeRequiredId(rawInput.tripNumber, "Número da viagem"),
    tripDateLabel: normalizeRequiredId(rawInput.tripDateLabel, "Data da viagem"),
    tripValue: Number.isFinite(Number(rawInput.tripValue))
      ? Number(rawInput.tripValue)
      : 0,
    reasons: normalizeReasons(
      rawInput.reasons,
      TRIP_DELETION_REASON_OPTIONS,
      "Selecione ao menos um motivo para a exclusão.",
    ),
    suspension: rawInput.suspension
      ? normalizeSuspensionInput({
          ...rawInput.suspension,
          tripId: rawInput.tripId,
          driverId: rawInput.driverId,
          companyId: rawInput.companyId,
        })
      : null,
  };

  const tripRef = doc(db, "historico_viagens", input.tripId);
  const auditRef = doc(collection(db, "trip_deletion_audits"));
  const notificationRef = doc(
    db,
    "notifications",
    safeDocumentId(`${input.driverId}_trip_deleted_${input.tripId}`),
  );
  const reasonsText = input.reasons.join(", ");
  const valueLabel = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(input.tripValue);
  const deletionNotification = buildNotificationPayload({
    userId: input.driverId,
    companyId: input.companyId,
    type: "TRIP_DELETED",
    targetProfile: "driver",
    title: "Viagem excluída",
    message: `A viagem nº ${input.tripNumber}, executada em ${input.tripDateLabel}, no valor de ${valueLabel}, foi excluída. Motivo(s): ${reasonsText}.`,
    metadata: {
      tripId: input.tripId,
      tripNumber: input.tripNumber,
      tripDate: input.tripDateLabel,
      tripValue: input.tripValue,
      reasons: input.reasons,
    },
    dedupeKey: `TRIP_DELETED_${input.tripId}`,
  });

  const suspensionWrite = input.suspension
    ? buildSuspensionWrite(input.suspension, actorUserId)
    : null;
  const suspensionNotification =
    input.suspension && suspensionWrite
      ? buildSuspensionNotification(input.suspension, suspensionWrite.endsAt)
      : null;
  const suspensionNotificationRef = input.suspension
    ? doc(
        db,
        "notifications",
        safeDocumentId(
          `${input.driverId}_suspension_trip_${input.tripId}_${suspensionWrite?.endsAt.seconds}`,
        ),
      )
    : null;
  const suspensionAuditRef = input.suspension
    ? doc(collection(db, "driver_suspension_audits"))
    : null;
  const userRef = input.suspension ? doc(db, "users", input.driverId) : null;

  await runTransaction(db, async (transaction) => {
    const tripSnapshot = await transaction.get(tripRef);
    const userSnapshot = userRef ? await transaction.get(userRef) : null;

    if (!tripSnapshot.exists()) {
      throw new Error("A viagem já foi excluída ou não está mais disponível.");
    }
    assertTripMatchesModeration(
      tripSnapshot.data(),
      input.driverId,
      input.companyId,
    );
    if (userRef && (!userSnapshot || !userSnapshot.exists())) {
      throw new Error("Cadastro do motorista não encontrado para aplicar a suspensão.");
    }

    transaction.delete(tripRef);
    transaction.set(notificationRef, deletionNotification);
    transaction.set(auditRef, {
      tripId: input.tripId,
      driverId: input.driverId,
      companyId: input.companyId,
      tripNumber: input.tripNumber,
      tripDate: input.tripDateLabel,
      tripValue: input.tripValue,
      reasons: input.reasons,
      createdAt: serverTimestamp(),
      actorUserId,
      schemaVersion: 1,
    });

    if (
      userRef &&
      suspensionWrite &&
      suspensionNotification &&
      suspensionNotificationRef &&
      suspensionAuditRef &&
      input.suspension
    ) {
      transaction.update(userRef, suspensionWrite.userUpdate);
      transaction.set(suspensionNotificationRef, suspensionNotification);
      transaction.set(suspensionAuditRef, {
        driverId: input.driverId,
        companyId: input.companyId,
        tripId: input.tripId,
        durationHours: input.suspension.durationHours,
        reasons: input.suspension.reasons,
        message: String(input.suspension.message || "").trim(),
        startsAt: suspensionWrite.startsAt,
        endsAt: suspensionWrite.endsAt,
        createdAt: serverTimestamp(),
        actorUserId,
        schemaVersion: 1,
      });
    }
  });

  return {
    suspensionEndsAt: suspensionWrite?.endsAt.toDate() || null,
  };
}
