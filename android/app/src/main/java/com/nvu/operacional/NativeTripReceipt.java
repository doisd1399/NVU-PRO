package com.nvu.operacional;

/** Immutable presentation snapshot. It never changes the sealed submission payload. */
final class NativeTripReceipt {
    enum State { CONFIRMED, PENDING, ACTION_REQUIRED }
    final State state;
    final String sessionId, tripId, driverId, companyId, jobId;
    final String heading, origin, destination, earnings;
    final int progress, total;

    NativeTripReceipt(State state, String sessionId, String tripId, String driverId,
        String companyId, String jobId, String heading, String origin, String destination,
        String earnings, int progress, int total) {
        this.state = state == null ? State.PENDING : state;
        this.sessionId = clean(sessionId);
        this.tripId = clean(tripId);
        this.driverId = clean(driverId);
        this.companyId = clean(companyId);
        this.jobId = clean(jobId);
        String pendingHeading = clean(heading);
        if (pendingHeading.isEmpty() || pendingHeading.toLowerCase(java.util.Locale.ROOT).contains("viagem registrada")) {
            pendingHeading = "Aguardando envio";
        }
        this.heading = this.state == State.CONFIRMED ? "Viagem registrada" : pendingHeading;
        this.origin = clean(origin);
        this.destination = clean(destination);
        this.earnings = clean(earnings).isEmpty() ? "—" : clean(earnings);
        this.total = Math.max(0, total);
        this.progress = this.total > 0 ? Math.min(Math.max(0, progress), this.total)
            : Math.max(0, progress);
    }

    String route() {
        return (origin.isEmpty() ? "Origem indisponível" : origin) + " → "
            + (destination.isEmpty() ? "Destino indisponível" : destination);
    }

    String counter() { return total > 0 ? progress + "/" + total : "—"; }
    float fraction() { return total > 0 ? progress / (float) total : 0f; }

    boolean belongsTo(String viewerId) {
        return !driverId.isEmpty() && driverId.equals(clean(viewerId));
    }

    boolean sameConfirmation(NativeTripReceipt other) {
        return other != null && state == other.state && driverId.equals(other.driverId)
            && companyId.equals(other.companyId) && jobId.equals(other.jobId)
            && !sessionId.isEmpty() && sessionId.equals(other.sessionId)
            && tripId.equals(other.tripId);
    }

    static String clean(String value) { return value == null ? "" : value.trim(); }
}
