package com.nvu.operacional;

import android.content.SharedPreferences;

import org.json.JSONException;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.UUID;

/**
 * Single source of truth for a freight after it has passed the List or Pause contract.
 *
 * The service may keep OCR candidates and legacy aliases for diagnostics, but every
 * consumer after certification must read this sealed object. No consumer is allowed
 * to recompute destination/origin from mutable preferences.
 */
final class GtoCertifiedFreight {
    static final int SCHEMA_VERSION = 1;
    static final String PREF_KEY = "certifiedFreight";
    static final String STATUS_CERTIFIED = "CERTIFIED";

    private static final String[] FIELDS = new String[] {
        "cargo", "origin", "destination", "distanceKm", "offeredValue",
        "rawText", "companyRoute", "originCompany", "destinationCompany",
        "acceptedListOrigin", "acceptedListDestination", "selectedRow"
    };

    private GtoCertifiedFreight() {}

    static JSONObject read(SharedPreferences prefs) {
        if (prefs == null) return null;
        String raw = clean(prefs.getString(PREF_KEY, ""));
        if (raw.isEmpty()) return null;
        try {
            JSONObject value = new JSONObject(raw);
            String sessionId = prefs.getString("gtoTripSessionId", "");
            if (!isValid(value, sessionId)) return null;
            String beforeRepair = value.toString();
            repairCanonicalDestination(value, sessionId);
            if (!beforeRepair.equals(value.toString())) {
                SharedPreferences.Editor editor = prefs.edit();
                applyToPrefs(editor, value);
                editor.commit();
            }
            return value;
        } catch (Exception ignored) {
            return null;
        }
    }

    /**
     * Converts one already-parsed candidate into the only certified freight object.
     * List-only canonicalization is executed here, exactly once, before sealing.
     */
    static JSONObject seal(JSONObject candidate, SharedPreferences prefs, String source) {
        if (candidate == null) return null;
        String safeSource = normalizeSource(source);
        String sessionId = clean(prefs == null ? "" : prefs.getString("gtoTripSessionId", ""));
        if (sessionId.isEmpty()) return null;

        try {
            JSONObject sealed = new JSONObject(candidate.toString());
            int selectedRow = selectedRow(sealed);
            if (selectedRow < 0) return null;

            String cargo = clean(sealed.optString("cargo", ""));
            String origin = clean(sealed.optString("origin", ""));
            String destination = clean(sealed.optString("destination", ""));
            String originCompany = clean(sealed.optString("originCompany", ""));
            String destinationCompany = clean(sealed.optString("destinationCompany", ""));
            String companyRoute = clean(sealed.optString("companyRoute", ""));
            String rawText = clean(sealed.optString("rawText", ""));
            String acceptedOrigin = clean(sealed.optString("acceptedListOrigin", ""));
            String acceptedDestination = clean(sealed.optString("acceptedListDestination", ""));
            boolean manualRouteSelection = sealed.optBoolean("manualRouteSelectionConfirmed", false);

            if (!manualRouteSelection) {
                destination = GtoDestinationTextAuthorityPolicy.canonicalizeListDestination(destination);
                destinationCompany = GtoDestinationTextAuthorityPolicy.canonicalizeListCompany(destinationCompany);
                acceptedDestination = GtoDestinationTextAuthorityPolicy.canonicalizeListDestination(acceptedDestination);
                companyRoute = GtoDestinationTextAuthorityPolicy.canonicalizeRoute(companyRoute);
            }

            if ("LIST".equals(safeSource) && !manualRouteSelection) {
                origin = GtoListOriginTextPolicy.canonicalizeOcrLiteral(origin);
                originCompany = GtoListOriginTextPolicy.canonicalizeOcrLiteral(originCompany);
                acceptedOrigin = GtoListOriginTextPolicy.canonicalizeOcrLiteral(acceptedOrigin);
                boolean directRowAuthority = sealed.optBoolean("directSelectedRowEvidence", false);
                boolean originRowAuthority = directRowAuthority
                    || sealed.optBoolean("originSelectedRowEvidence", false);
                boolean destinationRowAuthority = directRowAuthority
                    || sealed.optBoolean("destinationSelectedRowEvidence", false);
                if (!originRowAuthority) {
                    origin = GtoAcceptedFreightFieldPolicy.acceptedVisibleOrigin(
                        acceptedOrigin, origin, originCompany, false, false
                    );
                }
                if (!destinationRowAuthority) {
                    destination = GtoAcceptedFreightFieldPolicy.acceptedVisibleDestination(
                        acceptedDestination, destination, destinationCompany, rawText,
                        companyRoute, originCompany, false
                    );
                } else {
                    // Same-row authority identifies the selected card, but a wrapped
                    // route can still leave destination as the final locality only.
                    // Compose the exact same-row company/locality before sealing, then
                    // apply the bounded official-city spelling rule to the complete value.
                    String composedDestination = GtoAcceptedFreightFieldPolicy.destination(
                        destination, destinationCompany, rawText
                    );
                    if (!composedDestination.isEmpty()) destination = composedDestination;
                    String selectedRowCanonical = GtoCityTextResolver.canonicalizeSelectedRowDestination(
                        destination
                    );
                    if (!selectedRowCanonical.isEmpty()) destination = selectedRowCanonical;
                }
                acceptedOrigin = origin;
                acceptedDestination = destination;
            }

            if (!manualRouteSelection) {
                destination = GtoDestinationTextAuthorityPolicy.canonicalizeListDestination(destination);
                destinationCompany = GtoDestinationTextAuthorityPolicy.canonicalizeListCompany(destinationCompany);
                acceptedDestination = GtoDestinationTextAuthorityPolicy.canonicalizeListDestination(acceptedDestination);
                companyRoute = GtoDestinationTextAuthorityPolicy.canonicalizeRoute(companyRoute);
            }
            if (acceptedDestination.isEmpty()) acceptedDestination = destination;

            // The new GTO contract deliberately does not collect cargo. Origin and
            // destination are selected by the driver from the closed route list.
            if (origin.length() < 2 || destination.length() < 2) return null;
            if (safeSource.isEmpty()) return null;

            JSONObject previous = readRaw(prefs == null ? null : prefs.getString(PREF_KEY, ""));
            boolean sameSelection = previous != null
                && sessionId.equals(clean(previous.optString("sessionId", "")))
                && selectedRow == selectedRow(previous);
            String authorityId = sameSelection
                ? clean(previous.optString("authorityId", ""))
                : "gto-" + UUID.randomUUID();
            if (authorityId.isEmpty()) authorityId = "gto-" + UUID.randomUUID();

            int previousRevision = sameSelection ? Math.max(0, previous.optInt("revision", 0)) : 0;
            String sourceLineFingerprint = sha256(
                "session=" + sessionId
                    + "|row=" + selectedRow
                    + "|raw=" + rawText
                    + "|cargo=" + cargo
                    + "|origin=" + origin
                    + "|destination=" + destination
            );
            String evidenceFingerprint = sha256(
                "authority=" + authorityId
                    + "|line=" + sourceLineFingerprint
                    + "|source=" + safeSource
                    + "|cargoVotes=" + sealed.optInt("cargoVotes", 0)
                    + "|cargoSelectedRowEvidence=" + sealed.optBoolean("cargoSelectedRowEvidence", false)
                    + "|cargoListSameRowAuthority=" + sealed.optBoolean("cargoListSameRowAuthority", false)
                    + "|originVotes=" + sealed.optInt("originVotes", 0)
                    + "|destinationVotes=" + sealed.optInt("destinationVotes", 0)
                    + "|cargo=" + cargo
                    + "|origin=" + origin
                    + "|destination=" + destination
                    + "|km=" + clean(sealed.optString("distanceKm", sealed.optString("km", "")))
                    + "|value=" + clean(sealed.optString("offeredValue", ""))
            );

            sealed.put("schemaVersion", SCHEMA_VERSION);
            sealed.put("authorityId", authorityId);
            sealed.put("sessionId", sessionId);
            sealed.put("source", safeSource);
            sealed.put("sourceLineIndex", selectedRow);
            sealed.put("sourceLineFingerprint", sourceLineFingerprint);
            sealed.put("evidenceFingerprint", evidenceFingerprint);
            sealed.put("revision", previousRevision + 1);
            sealed.put("certifiedAt", System.currentTimeMillis());
            sealed.put("certified", true);
            sealed.put("cargo", cargo);
            sealed.put("origin", origin);
            sealed.put("originCompany", originCompany);
            sealed.put("destination", destination);
            sealed.put("destinationCompany", destinationCompany);
            sealed.put("companyRoute", companyRoute);
            sealed.put("acceptedListOrigin", acceptedOrigin);
            sealed.put("acceptedListDestination", acceptedDestination);
            sealed.put("distanceKm", clean(sealed.optString("distanceKm", sealed.optString("km", ""))));
            sealed.put("selectedRow", selectedRow);
            // Keep the server-compatible freight fingerprint as a projection of this
            // same canonical object; no later layer may recompute it from mutable prefs.
            sealed.put("freightFingerprint", freightFingerprint(sealed));
            sealed.put("selectionAuthorityStatus", STATUS_CERTIFIED);
            sealed.put("fieldProvenance", provenance(sealed, safeSource, selectedRow));
            return sealed;
        } catch (Exception ignored) {
            return null;
        }
    }

    /**
     * Repairs older certified snapshots before they are projected to prefs, cards or
     * payloads. This is a closed token alias migration, not fuzzy correction.
     */
    private static void repairCanonicalDestination(JSONObject sealed, String sessionId) throws JSONException {
        if (sealed == null) return;
        String source = normalizeSource(sealed.optString("source", ""));
        String cargo = clean(sealed.optString("cargo", ""));
        String origin = clean(sealed.optString("origin", ""));
        String destination = GtoDestinationTextAuthorityPolicy.canonicalizeListDestination(
            sealed.optString("destination", "")
        );
        String destinationCompany = GtoDestinationTextAuthorityPolicy.canonicalizeListCompany(
            sealed.optString("destinationCompany", "")
        );
        String acceptedDestination = GtoDestinationTextAuthorityPolicy.canonicalizeListDestination(
            sealed.optString("acceptedListDestination", "")
        );
        String rawText = clean(sealed.optString("rawText", ""));
        String companyRoute = GtoDestinationTextAuthorityPolicy.canonicalizeRoute(
            sealed.optString("companyRoute", "")
        );
        if ("LIST".equals(source)) {
            destination = GtoAcceptedFreightFieldPolicy.destination(
                destination, destinationCompany, rawText
            );
            acceptedDestination = GtoAcceptedFreightFieldPolicy.acceptedVisibleDestination(
                acceptedDestination, destination, destinationCompany, rawText,
                companyRoute, sealed.optString("originCompany", "")
            );
        }
        destination = GtoDestinationTextAuthorityPolicy.canonicalizeListDestination(destination);
        acceptedDestination = GtoDestinationTextAuthorityPolicy.canonicalizeListDestination(acceptedDestination);
        if (acceptedDestination.isEmpty()) acceptedDestination = destination;
        destinationCompany = GtoDestinationTextAuthorityPolicy.canonicalizeListCompany(destinationCompany);
        String previousDestination = sealed.optString("destination", "");
        String previousAccepted = sealed.optString("acceptedListDestination", "");
        String previousCompany = sealed.optString("destinationCompany", "");
        String previousRoute = sealed.optString("companyRoute", "");
        boolean changed = !clean(previousDestination).equals(destination)
            || !clean(previousAccepted).equals(acceptedDestination)
            || !clean(previousCompany).equals(destinationCompany)
            || !clean(previousRoute).equals(companyRoute);
        if (!changed) return;

        int selectedRow = selectedRow(sealed);
        String authorityId = clean(sealed.optString("authorityId", ""));
        String safeSession = clean(sessionId);
        String sourceLineFingerprint = sha256(
            "session=" + safeSession
                + "|row=" + selectedRow
                + "|raw=" + rawText
                + "|cargo=" + cargo
                + "|origin=" + origin
                + "|destination=" + destination
        );
        String evidenceFingerprint = sha256(
            "authority=" + authorityId
                + "|line=" + sourceLineFingerprint
                + "|source=" + source
                + "|cargoVotes=" + sealed.optInt("cargoVotes", 0)
                + "|cargoSelectedRowEvidence=" + sealed.optBoolean("cargoSelectedRowEvidence", false)
                + "|cargoListSameRowAuthority=" + sealed.optBoolean("cargoListSameRowAuthority", false)
                + "|originVotes=" + sealed.optInt("originVotes", 0)
                + "|destinationVotes=" + sealed.optInt("destinationVotes", 0)
                + "|cargo=" + cargo
                + "|origin=" + origin
                + "|destination=" + destination
                + "|km=" + clean(sealed.optString("distanceKm", sealed.optString("km", "")))
                + "|value=" + clean(sealed.optString("offeredValue", ""))
        );
        sealed.put("destination", destination);
        sealed.put("destinationCompany", destinationCompany);
        sealed.put("acceptedListDestination", acceptedDestination);
        sealed.put("companyRoute", companyRoute);
        sealed.put("sourceLineFingerprint", sourceLineFingerprint);
        sealed.put("evidenceFingerprint", evidenceFingerprint);
        sealed.put("freightFingerprint", freightFingerprint(sealed));
        sealed.put("fieldProvenance", provenance(sealed, source, selectedRow));
    }

    /** Copies only the sealed freight fields into an outbound payload. */
    static void copyIntoPayload(JSONObject payload, JSONObject certified) throws JSONException {
        if (payload == null || certified == null) return;
        for (String field : FIELDS) {
            if ("selectedRow".equals(field)) payload.put(field, selectedRow(certified));
            else payload.put(field, certified.optString(field, ""));
        }
        payload.put("freightAuthorityId", clean(certified.optString("authorityId", "")));
        payload.put("freightAuthorityRevision", Math.max(0, certified.optInt("revision", 0)));
        payload.put("freightSource", normalizeSource(certified.optString("source", "")));
        payload.put("sourceLineIndex", selectedRow(certified));
        payload.put("sourceLineFingerprint", clean(certified.optString("sourceLineFingerprint", "")));
        payload.put("evidenceFingerprint", clean(certified.optString("evidenceFingerprint", "")));
        payload.put("cargoVotes", Math.max(0, certified.optInt("cargoVotes", 0)));
        payload.put("cargoSelectedRowEvidence", certified.optBoolean("cargoSelectedRowEvidence", false));
        payload.put("cargoListSameRowAuthority", certified.optBoolean("cargoListSameRowAuthority", false));
        payload.put("manualRouteSelectionConfirmed", certified.optBoolean("manualRouteSelectionConfirmed", false));
    }

    /** Writes the certified object and compatibility aliases in one SharedPreferences transaction. */
    static void applyToPrefs(SharedPreferences.Editor editor, JSONObject certified) {
        if (editor == null || certified == null) return;
        String source = normalizeSource(certified.optString("source", ""));
        editor.putString(PREF_KEY, certified.toString())
            // Legacy key is a read-only compatibility projection from this point onward.
            .putString("selectedFreight", certified.toString())
            .putString("freightAuthorityStatus", STATUS_CERTIFIED)
            .putString("freightAuthorityId", clean(certified.optString("authorityId", "")))
            .putInt("freightAuthorityRevision", Math.max(0, certified.optInt("revision", 0)))
            .putInt("selectedFreightRow", selectedRow(certified))
            .putString("selectedCargo", clean(certified.optString("cargo", "")))
            .putString("selectedOrigin", clean(certified.optString("origin", "")))
            .putString("selectedDestination", clean(certified.optString("destination", "")))
            .putString("selectedAcceptedListOrigin", clean(certified.optString("acceptedListOrigin", "")))
            .putString("selectedAcceptedListDestination", clean(certified.optString("acceptedListDestination", "")))
            .putString("selectedOriginCompany", clean(certified.optString("originCompany", "")))
            .putString("selectedDestinationCompany", clean(certified.optString("destinationCompany", "")))
            .putString("selectedCompanyRoute", clean(certified.optString("companyRoute", "")))
            .putString("selectedKm", clean(certified.optString("distanceKm", certified.optString("km", ""))))
            .putString("selectedValue", clean(certified.optString("offeredValue", "")))
            .putInt("selectedCargoConsensusReads", Math.max(0, certified.optInt("cargoVotes", 0)))
            .putBoolean("selectedCargoSelectedRowEvidence", certified.optBoolean("cargoSelectedRowEvidence", false))
            .putBoolean("selectedCargoListSameRowAuthority", certified.optBoolean("cargoListSameRowAuthority", false))
            .putString("selectedOriginSource", source)
            .putString("selectedDestinationSource", source)
            .putString("selectedCargoSource", certified.optBoolean("manualRouteSelectionConfirmed", false)
                ? GtoManualRouteSelectionPolicy.SOURCE : source)
            .putBoolean("manualRouteSelectionConfirmed", certified.optBoolean("manualRouteSelectionConfirmed", false))
            .putString("selectionSource", source)
            // Preserve the human touch/gesture marker. The source of the freight
            // parser is not the same thing as proof that the driver selected a row.
            .putString("selectionConfirmationStatus", "CONFIRMED")
            .putString("selectionIdentityStatus", "CONFIRMED");
    }

    /** Copies the sealed object into a durable trip snapshot without recalculating fields. */
    static void copyIntoSnapshot(JSONObject snapshot, JSONObject certified) throws JSONException {
        if (snapshot == null || certified == null) return;
        snapshot.put(PREF_KEY, new JSONObject(certified.toString()));
        snapshot.put("freightAuthorityId", clean(certified.optString("authorityId", "")));
        snapshot.put("freightAuthorityRevision", Math.max(0, certified.optInt("revision", 0)));
        for (String field : FIELDS) {
            if ("selectedRow".equals(field)) snapshot.put(field, selectedRow(certified));
            else snapshot.put(field, certified.optString(field, ""));
        }
        snapshot.put("source", normalizeSource(certified.optString("source", "")));
        snapshot.put("sourceLineIndex", selectedRow(certified));
        snapshot.put("sourceLineFingerprint", clean(certified.optString("sourceLineFingerprint", "")));
        snapshot.put("evidenceFingerprint", clean(certified.optString("evidenceFingerprint", "")));
        snapshot.put("cargoVotes", Math.max(0, certified.optInt("cargoVotes", 0)));
        snapshot.put("cargoSelectedRowEvidence", certified.optBoolean("cargoSelectedRowEvidence", false));
        snapshot.put("cargoListSameRowAuthority", certified.optBoolean("cargoListSameRowAuthority", false));
        snapshot.put("authorityId", clean(certified.optString("authorityId", "")));
        snapshot.put("certifiedFreightRevision", Math.max(0, certified.optInt("revision", 0)));
        snapshot.put("manualRouteSelectionConfirmed", certified.optBoolean("manualRouteSelectionConfirmed", false));
    }

    static String summary(JSONObject certified) {
        if (certified == null) return "";
        String cargo = clean(certified.optString("cargo", ""));
        String origin = clean(certified.optString("origin", ""));
        String destination = clean(certified.optString("destination", ""));
        String km = clean(certified.optString("distanceKm", certified.optString("km", "")));
        String value = clean(certified.optString("offeredValue", ""));
        StringBuilder result = new StringBuilder();
        if (!cargo.isEmpty()) result.append(cargo);
        if (!origin.isEmpty() || !destination.isEmpty()) {
            if (result.length() > 0) result.append(" · ");
            result.append(origin.isEmpty() ? "—" : origin)
                .append(" → ")
                .append(destination.isEmpty() ? "—" : destination);
        }
        if (!km.isEmpty()) result.append(" · ").append(km);
        if (!value.isEmpty()) result.append(" · ").append(value);
        return result.toString();
    }

    static boolean isValid(JSONObject value, String expectedSessionId) {
        if (value == null || !value.optBoolean("certified", false)) return false;
        if (value.optInt("schemaVersion", 0) < SCHEMA_VERSION) return false;
        String session = clean(value.optString("sessionId", ""));
        if (session.isEmpty() || (!clean(expectedSessionId).isEmpty() && !session.equals(clean(expectedSessionId)))) return false;
        if (clean(value.optString("authorityId", "")).isEmpty()) return false;
        if (clean(value.optString("sourceLineFingerprint", "")).length() != 64) return false;
        if (clean(value.optString("evidenceFingerprint", "")).length() != 64) return false;
        String source = normalizeSource(value.optString("source", ""));
        if (source.isEmpty()) return false;
        if (selectedRow(value) < 0) return false;
        for (String field : new String[] {"origin", "destination"}) {
            String text = clean(value.optString(field, ""));
            if (text.length() < 2 || text.length() > 220) return false;
        }
        // Cargo is intentionally optional in the manual-route contract. An empty
        // value means that no cargo OCR or driver prompt was used.
        return true;
    }

    static String validationIssue(JSONObject value, String expectedSessionId) {
        if (value == null) return "Autoridade certificada ausente.";
        if (!isValid(value, expectedSessionId)) return "Autoridade certificada inválida ou incompatível com a sessão.";
        return null;
    }

    static JSONObject readRaw(String raw) {
        String value = clean(raw);
        if (value.isEmpty()) return null;
        try { return new JSONObject(value); } catch (Exception ignored) { return null; }
    }

    static int selectedRow(JSONObject value) {
        if (value == null) return -1;
        if (value.has("selectedRow")) return value.optInt("selectedRow", -1);
        if (value.has("rowIndex")) return value.optInt("rowIndex", -1);
        return value.optInt("row", -1);
    }

    private static JSONObject provenance(JSONObject value, String source, int selectedRow) throws JSONException {
        JSONObject result = new JSONObject();
        result.put("source", source);
        result.put("sourceLineIndex", selectedRow);
        result.put("sameRowOnly", true);
        result.put("cargo", fieldEvidence(value, source, selectedRow, "cargoVotes", "cargoSelectedRowEvidence"));
        result.put("origin", fieldEvidence(value, source, selectedRow, "originVotes", "originSelectedRowEvidence"));
        result.put("destination", fieldEvidence(value, source, selectedRow, "destinationVotes", "destinationSelectedRowEvidence"));
        return result;
    }

    private static JSONObject fieldEvidence(JSONObject value, String source, int row, String votesKey, String rowKey) throws JSONException {
        JSONObject result = new JSONObject();
        result.put("source", source);
        result.put("sourceLineIndex", row);
        result.put("votes", Math.max(0, value.optInt(votesKey, 0)));
        result.put("selectedRowEvidence", value.optBoolean(rowKey, false));
        result.put("sameSession", true);
        return result;
    }

    private static String freightFingerprint(JSONObject freight) {
        StringBuilder canonical = new StringBuilder();
        for (String field : new String[] {
            "cargo", "companyRoute", "originCompany", "destinationCompany", "origin",
            "destination", "distanceKm", "offeredValue", "rawText", "selectedRow"
        }) {
            String value = "selectedRow".equals(field)
                ? String.valueOf(selectedRow(freight))
                : clean(freight.optString(field, ""));
            canonical.append(field).append('=').append(value.length()).append(':').append(value).append('|');
        }
        return sha256(canonical.toString());
    }

    private static String normalizeSource(String value) {
        String source = clean(value).toUpperCase(Locale.ROOT);
        if (source.contains("PAUSE")) return "PAUSE";
        if (source.contains("MANUAL")) return "MANUAL_REVIEW";
        if (source.contains("LIST") || source.contains("ROW") || source.contains("OCR")) return "LIST";
        return source;
    }

    private static String clean(String value) {
        return value == null ? "" : value.replaceAll("\\s+", " ").trim();
    }

    private static String sha256(String value) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256")
                .digest((value == null ? "" : value).getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder(hash.length * 2);
            for (byte item : hash) result.append(String.format(Locale.ROOT, "%02x", item & 0xff));
            return result.toString();
        } catch (Exception ignored) {
            return "";
        }
    }
}
