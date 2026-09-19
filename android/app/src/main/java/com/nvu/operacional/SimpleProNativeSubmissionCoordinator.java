package com.nvu.operacional;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.annotation.NonNull;

import com.google.android.gms.tasks.Task;
import com.google.android.gms.tasks.Tasks;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.firestore.DocumentReference;
import com.google.firebase.firestore.DocumentSnapshot;
import com.google.firebase.firestore.FirebaseFirestore;
import com.google.firebase.firestore.QuerySnapshot;
import com.google.firebase.firestore.SetOptions;
import com.google.firebase.Timestamp;
import com.google.firebase.firestore.FieldValue;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Native owner for Pro completion after a readable receipt is captured.
 *
 * This is deliberately not a second retry queue. It performs one immediate,
 * authenticated write using a deterministic document id. If any mandatory
 * check cannot be completed, it hands the immutable capture to the Web bridge
 * instead of claiming success or silently dropping it.
 */
final class SimpleProNativeSubmissionCoordinator {
    interface Listener {
        void onSuccess(String tripId);
        void onFallback(String reason);
    }

    private static final String PRO_STATE_SUBMITTING = "SUBMITTING_NATIVE";
    private static final String PRO_STATE_FALLBACK = "WEB_FALLBACK";
    private static final int MAX_DUPLICATE_WINDOW = 50;
    private static final Pattern AMOUNT_PATTERN = Pattern.compile("(?:R\\$|EUR|BRL|€|\\$)?\\s*([0-9]+(?:[.,][0-9]{3})*(?:[.,][0-9]{1,2})?)", Pattern.CASE_INSENSITIVE);
    private static final Pattern PERCENT_OFFER = Pattern.compile("BONUS\\s+DE\\s+[0-9]+\\s*%|REMOVER\\s+PENALIDADES|DOBRAR\\s+VALOR");
    private static final Set<String> ZERO_BONUS_LINES = new HashSet<>(Arrays.asList(
        "BONUS VIDEO ADS", "BONUS ADS", "BONUS DE ADS", "BONUS VIDEO", "VIDEO ADS"
    ));

    private SimpleProNativeSubmissionCoordinator() {}

    static void submit(Context context, SharedPreferences prefs, String rawReceipt, Listener listener) {
        if (context == null || prefs == null || listener == null) return;
        Context appContext = context.getApplicationContext();
        String driverId = clean(prefs.getString("driverId", ""));
        String jobId = clean(prefs.getString("captureJobId", prefs.getString("jobId", "")));
        String companyId = clean(prefs.getString("captureCompanyId", prefs.getString("companyId", "")));
        String contractId = clean(prefs.getString("captureContractId", prefs.getString("contractId", "")));
        String attemptId = clean(prefs.getString("captureAttemptId", ""));
        String contextEpoch = clean(prefs.getString("captureContextEpoch", ""));
        String origin = clean(prefs.getString("captureOrigin", ""));
        String destination = clean(prefs.getString("captureDestination", ""));
        String simulatorKey = clean(prefs.getString("captureSimulatorKey", prefs.getString("simulatorKey", "")));
        String simulatorCode = clean(prefs.getString("captureSimulatorCode", prefs.getString("simulatorCode", "")));
        String packageId = clean(prefs.getString("capturePackageId", prefs.getString("packageId", "")));

        prefs.edit()
            .putString("nativeSubmissionState", PRO_STATE_SUBMITTING)
            .putString("captureStage", "NATIVE_SUBMITTING")
            .apply();

        Receipt receipt = parseReceipt(simulatorKey, rawReceipt);
        String authUid = currentUid();
        String failure = validateLocalContext(
            driverId, authUid, jobId, companyId, contractId, attemptId, contextEpoch,
            origin, destination, simulatorKey, simulatorCode, packageId, receipt
        );
        if (!failure.isEmpty()) {
            fallback(prefs, failure, listener);
            return;
        }

        FirebaseFirestore db;
        try {
            db = FirebaseFirestore.getInstance();
        } catch (RuntimeException error) {
            fallback(prefs, "Firestore nativo indisponível", listener);
            return;
        }

        DocumentReference jobRef = db.collection("trabalhos").document(jobId);
        DocumentReference contractRef = db.collection("contratos").document(contractId);
        DocumentReference tripRef = db.collection("historico_viagens").document(deterministicTripId(driverId, attemptId));
        Task<DocumentSnapshot> existingTask = tripRef.get();
        Task<DocumentSnapshot> jobTask = jobRef.get();
        Task<DocumentSnapshot> contractTask = contractRef.get();

        Tasks.whenAllSuccess(existingTask, jobTask, contractTask).addOnCompleteListener(task -> {
            if (!task.isSuccessful()) {
                fallback(prefs, "Não foi possível confirmar a operação nativamente", listener);
                return;
            }
            try {
                DocumentSnapshot existing = existingTask.getResult();
                DocumentSnapshot jobSnapshot = jobTask.getResult();
                DocumentSnapshot contractSnapshot = contractTask.getResult();
                if (existing != null && existing.exists()) {
                    if (sameTripOwner(existing, driverId, companyId, jobId, contractId, attemptId)) {
                        SimpleAutomationService.recordConfirmedTrip(
                            appContext, tripRef.getId(), jobId, companyId, driverId, contractId,
                            simulatorKey, origin, destination, receipt.amountCents, System.currentTimeMillis()
                        );
                        nativeSuccess(prefs, tripRef.getId(), listener);
                    } else {
                        fallback(prefs, "A chave de idempotência já pertence a outra viagem", listener);
                    }
                    return;
                }
                if (jobSnapshot == null || !jobSnapshot.exists() || contractSnapshot == null || !contractSnapshot.exists()) {
                    fallback(prefs, "A operação ou contrato não está disponível", listener);
                    return;
                }
                Map<String, Object> job = jobSnapshot.getData() == null ? new HashMap<>() : jobSnapshot.getData();
                Map<String, Object> contract = contractSnapshot.getData() == null ? new HashMap<>() : contractSnapshot.getData();
                String jobDriverId = firstText(job, "driverId", "motoristaId", "userId");
                String jobCompanyId = firstText(job, "companyId", "empresaId");
                String jobContractId = firstText(job, "contractId", "contratoId");
                if (!driverId.equals(jobDriverId) || !companyId.equals(jobCompanyId) || !contractId.equals(jobContractId)) {
                    fallback(prefs, "A operação mudou antes do registro nativo", listener);
                    return;
                }
                int progress = integerValue(job.get("progress"));
                int total = Math.max(integerValue(job.get("totalDeliveries")), integerValue(contract.get("totalDeliveries")));
                String status = firstText(job, "status");
                if (!isRecordable(status, progress, total)) {
                    fallback(prefs, "Operação concluída ou indisponível", listener);
                    return;
                }

                Task<QuerySnapshot> duplicateTask = db.collection("historico_viagens")
                    .whereEqualTo("jobId", jobId)
                    .limit(MAX_DUPLICATE_WINDOW + 1)
                    .get();
                duplicateTask.addOnCompleteListener(duplicateResult -> {
                    if (!duplicateResult.isSuccessful()) {
                        fallback(prefs, "Não foi possível confirmar duplicidade", listener);
                        return;
                    }
                    QuerySnapshot duplicateSnapshot = duplicateResult.getResult();
                    if (duplicateSnapshot == null || duplicateSnapshot.size() > MAX_DUPLICATE_WINDOW) {
                        fallback(prefs, "Operação exige verificação completa no NVU", listener);
                        return;
                    }
                    if (hasConsecutiveDuplicate(duplicateSnapshot, driverId, companyId, simulatorCode, receipt.amountCents)) {
                        fallback(prefs, "Esta viagem Pro foi bloqueada porque o mesmo valor já foi registrado consecutivamente nesta operação", listener);
                        return;
                    }
                    writeTrip(appContext, prefs, tripRef, job, contract, receipt, driverId, companyId, contractId,
                        jobId, attemptId, contextEpoch, origin, destination, simulatorKey, simulatorCode, progress, total, listener);
                });
            } catch (RuntimeException error) {
                fallback(prefs, "Falha ao preparar registro nativo", listener);
            }
        });
    }

    private static void writeTrip(
        Context context,
        SharedPreferences prefs,
        DocumentReference tripRef,
        Map<String, Object> job,
        Map<String, Object> contract,
        Receipt receipt,
        String driverId,
        String companyId,
        String contractId,
        String jobId,
        String attemptId,
        String contextEpoch,
        String origin,
        String destination,
        String simulatorKey,
        String simulatorCode,
        int progress,
        int total,
        Listener listener
    ) {
        String vehicleId = firstText(job, "vehicleId", "veiculoId");
        String trailerId = firstText(job, "trailerId", "reboqueId");
        if (trailerId.isEmpty()) trailerId = firstText(contract, "trailerId", "reboqueId");
        String vehicleName = firstText(job, "vehicleName", "veiculoNome");
        if (vehicleName.isEmpty()) vehicleName = clean(prefs.getString("vehicleName", ""));
        String trailerName = firstText(job, "trailerName", "reboqueNome");
        if (trailerName.isEmpty()) trailerName = clean(prefs.getString("trailerName", ""));
        String companyName = clean(prefs.getString("companyName", "Empresa"));
        String contractName = clean(prefs.getString("contractName", ""));
        FirebaseUser user = FirebaseAuth.getInstance().getCurrentUser();
        String driverName = user == null || user.getDisplayName() == null ? "Motorista" : clean(user.getDisplayName());
        Map<String, Object> data = new HashMap<>();
        data.put("tripId", tripRef.getId());
        data.put("empresaId", companyId);
        data.put("companyId", companyId);
        data.put("empresaNome", companyName.isEmpty() ? "Empresa" : companyName);
        data.put("motoristaId", driverId);
        data.put("driverId", driverId);
        data.put("motoristaNome", driverName.isEmpty() ? "Motorista" : driverName);
        data.put("contratoId", contractId);
        data.put("contractId", contractId);
        data.put("contratoNumero", contractName);
        data.put("contratoDescricao", contractName);
        data.put("jobId", jobId);
        data.put("origem", origin);
        data.put("destino", destination);
        data.put("valor", receipt.amountCents / 100.0);
        data.put("valorCents", receipt.amountCents);
        data.put("valorDeteccaoMetodo", "simple_native_ocr");
        data.put("valorDetectadoAutomaticamente", true);
        data.put("valorBloqueadoPorDeteccao", true);
        data.put("status", "concluida");
        data.put("source", "simple_auto");
        data.put("registroAutomatico", true);
        data.put("automationSource", "simple-native-v1");
        data.put("criadoPor", driverId);
        data.put("dataLancamento", FieldValue.serverTimestamp());
        data.put("completedAt", FieldValue.serverTimestamp());
        data.put("createdAt", FieldValue.serverTimestamp());
        data.put("uploadedAt", FieldValue.serverTimestamp());
        data.put("simulatorKey", simulatorKey);
        data.put("simulatorId", simulatorKey);
        data.put("simulatorCode", simulatorCode);
        data.put("simulatorName", simulatorCode);
        data.put("simuladorNome", simulatorCode);
        data.put("simuladorCodigo", simulatorCode);
        data.put("veiculoId", vehicleId);
        data.put("veiculoNome", vehicleName);
        data.put("reboqueId", supportsTrailer(simulatorKey) ? trailerId : "");
        data.put("reboqueNome", supportsTrailer(simulatorKey) ? trailerName : "");
        data.put("simpleAutomation", true);
        data.put("simpleAutomationVersion", "v3-native-immediate");
        data.put("simpleReceiptCurrency", receipt.currency);
        data.put("simpleReceiptResultScreenConfirmed", true);
        data.put("simpleReceiptBonusEvidence", receipt.bonusEvidence);
        data.put("simpleReceiptConfidence", 1.0);
        data.put("simpleReceiptCapturedAt", prefs.getLong("receiptCapturedAt", 0L));
        data.put("simpleReceiptCaptureAttemptId", attemptId);
        data.put("simpleReceiptCaptureContextEpoch", contextEpoch);
        data.put("idempotencyKey", "simple:" + jobId + ":" + driverId + ":" + attemptId);
        data.put("simpleDuplicateGuardKey", "simple-value:" + jobId + ":" + driverId + ":" + receipt.amountCents);
        data.put("nativeSubmission", true);
        data.put("nativeSubmissionVersion", 1);

        tripRef.set(data, SetOptions.merge()).addOnCompleteListener(writeResult -> {
            if (!writeResult.isSuccessful()) {
                fallback(prefs, "A gravação nativa não foi confirmada", listener);
                return;
            }
            refreshNativeOperationSnapshot(context, prefs, job, contract, progress + 1, total);
            SimpleAutomationService.recordConfirmedTrip(
                context, tripRef.getId(), jobId, companyId, driverId, contractId,
                simulatorKey, origin, destination, receipt.amountCents, System.currentTimeMillis()
            );
            nativeSuccess(prefs, tripRef.getId(), listener);
        });
    }

    private static void refreshNativeOperationSnapshot(
        Context context,
        SharedPreferences prefs,
        Map<String, Object> job,
        Map<String, Object> contract,
        int progress,
        int total
    ) {
        String jobId = clean(prefs.getString("jobId", ""));
        String contractId = clean(prefs.getString("contractId", ""));
        String companyId = clean(prefs.getString("companyId", ""));
        String driverId = clean(prefs.getString("driverId", ""));
        String companyName = firstText(job, "companyName", "empresaNome");
        if (companyName.isEmpty()) companyName = firstText(contract, "companyName", "empresaNome");
        if (companyName.isEmpty()) companyName = clean(prefs.getString("companyName", "Empresa"));
        String operationName = firstText(job, "operationName", "operacaoNome", "operation", "operacao");
        if (operationName.isEmpty()) operationName = firstText(contract, "operationName", "operacaoNome", "operation", "operacao");
        if (operationName.isEmpty()) operationName = clean(prefs.getString("operationName", ""));
        String contractName = firstText(contract, "contractName", "contratoNome", "name", "nome", "numero", "number", "descricao");
        if (contractName.isEmpty()) contractName = clean(prefs.getString("contractName", ""));
        String vehicleName = firstText(job, "vehicleName", "veiculoNome");
        if (vehicleName.isEmpty()) vehicleName = clean(prefs.getString("vehicleName", ""));
        String trailerName = firstText(job, "trailerName", "reboqueNome");
        if (trailerName.isEmpty()) trailerName = firstText(contract, "trailerName", "reboqueNome");
        if (trailerName.isEmpty()) trailerName = clean(prefs.getString("trailerName", ""));
        String status = firstText(job, "status");
        SimpleAutomationService.refreshOperationSnapshot(
            context, companyName, operationName, contractName, jobId, contractId,
            companyId, driverId, progress, total, status, false, vehicleName, trailerName
        );
    }

    private static boolean sameTripOwner(DocumentSnapshot snapshot, String driverId, String companyId, String jobId, String contractId, String attemptId) {
        Map<String, Object> data = snapshot.getData();
        if (data == null) return false;
        return driverId.equals(firstText(data, "driverId", "motoristaId"))
            && companyId.equals(firstText(data, "companyId", "empresaId"))
            && jobId.equals(firstText(data, "jobId"))
            && contractId.equals(firstText(data, "contractId", "contratoId"))
            && attemptId.equals(firstText(data, "simpleReceiptCaptureAttemptId"));
    }

    private static boolean hasConsecutiveDuplicate(QuerySnapshot snapshot, String driverId, String companyId, String simulatorCode, int amountCents) {
        List<DocumentSnapshot> candidates = new ArrayList<>();
        for (DocumentSnapshot document : snapshot.getDocuments()) {
            Map<String, Object> data = document.getData();
            if (data == null || !Boolean.TRUE.equals(data.get("simpleAutomation"))) continue;
            if (!driverId.equals(firstText(data, "driverId", "motoristaId"))) continue;
            if (!companyId.equals(firstText(data, "companyId", "empresaId"))) continue;
            if (!simulatorCode.equals(firstText(data, "simulatorCode", "simuladorCodigo", "simulatorName"))) continue;
            if (!"concluida".equalsIgnoreCase(firstText(data, "status"))) continue;
            candidates.add(document);
        }
        candidates.sort(Comparator.comparingLong(SimpleProNativeSubmissionCoordinator::metricTime));
        if (candidates.isEmpty()) return false;
        DocumentSnapshot latest = candidates.get(candidates.size() - 1);
        return integerValue(latest.get("valorCents")) == amountCents;
    }

    private static long metricTime(DocumentSnapshot snapshot) {
        Object value = snapshot.get("completedAt");
        if (value instanceof Timestamp) return ((Timestamp) value).toDate().getTime();
        value = snapshot.get("createdAt");
        if (value instanceof Timestamp) return ((Timestamp) value).toDate().getTime();
        return 0L;
    }

    private static boolean isRecordable(String status, int progress, int total) {
        String normalized = clean(status).toLowerCase(Locale.ROOT);
        if ("active".equals(normalized) || "delayed".equals(normalized)) return total <= 0 || progress < total;
        return "awaiting_completion".equals(normalized) && total > 0 && progress < total;
    }

    private static String validateLocalContext(String driverId, String authUid, String jobId, String companyId, String contractId,
                                               String attemptId, String epoch, String origin, String destination,
                                               String simulatorKey, String simulatorCode, String packageId, Receipt receipt) {
        if (driverId.isEmpty() || authUid.isEmpty() || !driverId.equals(authUid)) return "Autenticação nativa não corresponde ao motorista";
        if (jobId.isEmpty() || companyId.isEmpty() || contractId.isEmpty() || attemptId.isEmpty() || epoch.isEmpty()) return "Contexto Pro incompleto";
        if (origin.isEmpty() || destination.isEmpty() || origin.equalsIgnoreCase(destination)) return "Rota Pro inválida";
        if (!isCanonicalSimulator(simulatorKey, simulatorCode, packageId)) return "Simulador Pro incompatível";
        if (receipt == null || receipt.amountCents <= 0 || !receipt.resultScreenConfirmed || !"NONE".equals(receipt.bonusEvidence) && !"ZERO_LABEL".equals(receipt.bonusEvidence) && !"OFFER_ONLY".equals(receipt.bonusEvidence)) return "Recibo Pro não aprovado";
        return "";
    }

    private static boolean isCanonicalSimulator(String key, String code, String packageId) {
        if ("global-truck".equals(key)) return "GTO".equals(code) && "com.stargamesapps.gto".equals(packageId);
        if ("toe-3".equals(key)) return "TOE3".equals(code) && "com.WandaSoftware.TruckersofEurope3".equals(packageId);
        if ("wtds".equals(key)) return "WTDS".equals(code) && "com.dynamicgames.worldtruckdrivingsimulator".equals(packageId);
        if ("wbds".equals(key)) return "WBDS".equals(code) && "com.dynamicgames.worldbusdrivingsimulator".equals(packageId);
        return false;
    }

    private static boolean supportsTrailer(String key) {
        return !"wbds".equals(key);
    }

    private static Receipt parseReceipt(String simulatorKey, String rawText) {
        String normalized = normalize(rawText);
        if (normalized.isEmpty()) return null;
        String[] required;
        String[] labels;
        String currency;
        if ("global-truck".equals(simulatorKey)) {
            required = new String[]{"CONCLUIDO"}; labels = new String[]{"VALOR A RECEBER"}; currency = "BRL";
        } else if ("toe-3".equals(simulatorKey)) {
            required = new String[]{"DISTANCIA", "TEMPO GASTO"}; labels = new String[]{"RENDA TOTAL", "GANHOS"}; currency = "EUR";
        } else {
            required = new String[]{"DANOS", "COMBUSTIVEL"}; labels = new String[]{"GANHOS DA VIAGEM", "TOTAL"}; currency = "BRL";
        }
        for (String marker : required) if (!normalized.contains(marker)) return null;
        boolean baseLabel = false;
        List<Integer> amounts = new ArrayList<>();
        for (String label : labels) {
            int index = normalized.indexOf(label);
            while (index >= 0) {
                baseLabel = true;
                String tail = normalized.substring(Math.min(normalized.length(), index + label.length()), Math.min(normalized.length(), index + label.length() + 45));
                Matcher matcher = AMOUNT_PATTERN.matcher(tail);
                if (matcher.find()) {
                    Integer cents = parseCents(matcher.group(1));
                    if (cents != null) amounts.add(cents);
                }
                index = normalized.indexOf(label, index + 1);
            }
        }
        if (!baseLabel || amounts.isEmpty()) return null;
        Set<Integer> distinct = new HashSet<>(amounts);
        if (distinct.size() != 1) return null;
        if (hasPositiveBonus(normalized) || hasExplicitDoubledValue(normalized)) return null;
        String bonusEvidence = normalized.contains("BONUS VIDEO ADS: 0") || normalized.contains("BONUS VIDEO ADS 0") ? "ZERO_LABEL" : "NONE";
        return new Receipt(amounts.get(0), currency, true, bonusEvidence);
    }

    private static boolean hasPositiveBonus(String normalized) {
        for (String label : ZERO_BONUS_LINES) {
            int index = normalized.indexOf(label);
            while (index >= 0) {
                String tail = normalized.substring(Math.min(normalized.length(), index + label.length()), Math.min(normalized.length(), index + label.length() + 35));
                Matcher matcher = Pattern.compile("[0-9]+(?:[.,][0-9]{1,2})?").matcher(tail);
                while (matcher.find()) {
                    Integer cents = parseCents(matcher.group());
                    if (cents != null && cents > 0) return true;
                }
                index = normalized.indexOf(label, index + 1);
            }
        }
        return false;
    }

    private static boolean hasExplicitDoubledValue(String normalized) {
        if (!normalized.matches(".*(?:VALOR DOBRADO|VALOR DUPLICADO|DOBRADO|DUPLICAD|2 X|2X|X 2|X2|X×|×2).*")) return false;
        Matcher matcher = Pattern.compile("(?:VALOR DOBRADO|VALOR DUPLICADO|DOBRADO|DUPLICAD|2 X|2X|X 2|X2|X×|×2)[^0-9]{0,20}([0-9]+(?:[.,][0-9]{1,2})?)").matcher(normalized);
        return matcher.find() && parseCents(matcher.group(1)) != null && parseCents(matcher.group(1)) > 0;
    }

    /**
     * Parses only an unambiguous monetary token. Native Pro must not infer
     * cents from a bare OCR integer and must not treat an international dot as
     * a Brazilian thousands separator (or vice versa) without evidence.
     * Web/Print use the same two-decimal contract before persistence.
     */
    private static Integer parseCents(String raw) {
        String cleaned = clean(raw).replaceAll("[^0-9.,]", "");
        if (cleaned.isEmpty()) return null;
        int comma = cleaned.lastIndexOf(',');
        int dot = cleaned.lastIndexOf('.');
        int separator = Math.max(comma, dot);
        if (separator < 1 || separator >= cleaned.length() - 1) return null;

        String decimal = cleaned.substring(separator + 1);
        if (decimal.length() != 2 || !decimal.matches("[0-9]{2}")) return null;

        String integerPart;
        if (comma >= 0 && dot >= 0) {
            // The rightmost separator is decimal; all earlier separators are
            // grouping separators and must be removed.
            integerPart = cleaned.substring(0, separator).replace(",", "").replace(".", "");
        } else if (comma >= 0) {
            integerPart = cleaned.substring(0, comma).replace(".", "");
        } else {
            integerPart = cleaned.substring(0, dot).replace(",", "");
        }
        integerPart = integerPart.replaceFirst("^0+(?=\\d)", "");
        if (integerPart.isEmpty() || !integerPart.matches("[0-9]+")) return null;

        try {
            long cents = Long.parseLong(integerPart) * 100L + Long.parseLong(decimal);
            if (cents <= 0L || cents > 100_000_000_000L) return null;
            return cents > Integer.MAX_VALUE ? null : (int) cents;
        } catch (RuntimeException error) {
            return null;
        }
    }

    private static String deterministicTripId(String driverId, String attemptId) {
        String raw = ("simple_" + driverId + "_" + attemptId).replaceAll("[^A-Za-z0-9_-]", "_");
        return raw.length() > 180 ? raw.substring(0, 180) : raw;
    }

    private static void nativeSuccess(SharedPreferences prefs, String tripId, Listener listener) {
        prefs.edit().putString("nativeSubmissionState", "SYNCED").putString("nativeTripId", tripId).apply();
        listener.onSuccess(tripId);
    }

    private static void fallback(SharedPreferences prefs, String reason, Listener listener) {
        prefs.edit().putString("nativeSubmissionState", PRO_STATE_FALLBACK).putString("nativeSubmissionError", clean(reason)).apply();
        listener.onFallback(clean(reason));
    }

    private static String currentUid() {
        FirebaseUser user = FirebaseAuth.getInstance().getCurrentUser();
        return user == null ? "" : clean(user.getUid());
    }

    private static String firstText(Map<String, Object> data, String... keys) {
        if (data == null) return "";
        for (String key : keys) {
            Object value = data.get(key);
            if (value != null && !clean(String.valueOf(value)).isEmpty()) return clean(String.valueOf(value));
        }
        return "";
    }

    private static int integerValue(Object value) {
        if (value instanceof Number) return Math.max(0, ((Number) value).intValue());
        try { return Math.max(0, Integer.parseInt(clean(String.valueOf(value)))); } catch (RuntimeException error) { return 0; }
    }

    private static String normalize(String value) {
        return Normalizer.normalize(clean(value), Normalizer.Form.NFD)
            .replaceAll("\\p{M}+", "")
            .toUpperCase(Locale.ROOT)
            .replaceAll("\\s+", " ")
            .trim();
    }

    private static String clean(String value) {
        return value == null ? "" : value.trim();
    }

    private static final class Receipt {
        final int amountCents;
        final String currency;
        final boolean resultScreenConfirmed;
        final String bonusEvidence;

        Receipt(int amountCents, String currency, boolean resultScreenConfirmed, String bonusEvidence) {
            this.amountCents = amountCents;
            this.currency = currency;
            this.resultScreenConfirmed = resultScreenConfirmed;
            this.bonusEvidence = bonusEvidence;
        }
    }
}
