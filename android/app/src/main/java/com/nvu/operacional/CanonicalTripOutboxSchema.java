package com.nvu.operacional;

/** Versioned Android representation of the Web CanonicalTripOutbox contract. */
public final class CanonicalTripOutboxSchema {
    public static final int VERSION = 1;
    public static final String STATE_PENDING_SYNC = "PENDING_SYNC";
    public static final String STATE_SYNCING = "SYNCING";
    public static final String STATE_SERVER_CONFIRMED = "SERVER_CONFIRMED";
    public static final String STATE_FAILED = "FAILED";
    public static final String STATE_CONFLICT = "CONFLICT";
    public static final String KEY_SCHEMA_VERSION = "outboxSchemaVersion";
    public static final String KEY_IDEMPOTENCY = "idempotencyKey";
    public static final String KEY_STATE = "outboxState";
    public static final String KEY_ATTEMPTS = "outboxAttempts";
    public static final String KEY_RETRY_AT = "retryAt";
    public static final String KEY_ACK_AT = "serverValidatedAt";

    private CanonicalTripOutboxSchema() {}
}
