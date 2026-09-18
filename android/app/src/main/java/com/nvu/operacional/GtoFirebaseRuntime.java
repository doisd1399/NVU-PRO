package com.nvu.operacional;

import android.content.Context;
import android.util.Log;

import com.google.firebase.FirebaseApp;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.functions.FirebaseFunctions;

import java.util.List;

/**
 * Optional Firebase boundary for the native GTO.
 *
 * Firebase is useful for authenticated registration and state ACKs when the app
 * contains valid google-services resources. It is not allowed to be a process
 * startup dependency: source-only/offline builds must still open the NVU UI and
 * preserve completed trips locally for later retry.
 */
final class GtoFirebaseRuntime {
    private static final String TAG = "GtoFirebaseRuntime";

    private GtoFirebaseRuntime() {}

    static FirebaseAuth auth(Context context) {
        try {
            if (!hasDefaultApp(context)) return null;
            return FirebaseAuth.getInstance();
        } catch (RuntimeException error) {
            Log.w(TAG, "Firebase Auth indisponível; mantendo o fluxo local", error);
            return null;
        }
    }

    static FirebaseUser currentUser(Context context) {
        FirebaseAuth auth = auth(context);
        if (auth == null) return null;
        try {
            return auth.getCurrentUser();
        } catch (RuntimeException error) {
            Log.w(TAG, "Não foi possível ler a sessão Firebase; mantendo o fluxo local", error);
            return null;
        }
    }

    static FirebaseFunctions functions(Context context, String region) {
        try {
            if (!hasDefaultApp(context)) return null;
            return FirebaseFunctions.getInstance(region);
        } catch (RuntimeException error) {
            Log.w(TAG, "Firebase Functions indisponível; mantendo a fila local", error);
            return null;
        }
    }

    static boolean isConfigured(Context context) {
        return hasDefaultApp(context);
    }

    private static boolean hasDefaultApp(Context context) {
        if (context == null) return false;
        try {
            List<FirebaseApp> apps = FirebaseApp.getApps(context.getApplicationContext());
            return apps != null && !apps.isEmpty();
        } catch (RuntimeException error) {
            Log.w(TAG, "Falha ao verificar configuração Firebase; tratando como indisponível", error);
            return false;
        }
    }
}
