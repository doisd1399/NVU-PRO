package com.nvu.operacional;

import android.app.Activity;
import android.content.Intent;
import android.media.projection.MediaProjectionConfig;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;

/** Requests a real user-authorized full-display projection, once per run. */
public final class ProOverlayProbeActivity extends Activity {
    private static final int CONSENT = 3939;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        if (state != null) { finish(); return; }
        if (ProOverlayProbeService.isActive()) {
            record("OVERLAY_OK", "Captura temporária já ativa");
            finish();
            return;
        }
        if (Settings.canDrawOverlays(this)) {
            record("ALREADY_GRANTED", "Sobreposição já ativa antes do teste; não prova a concessão temporária");
            finish();
            return;
        }
        MediaProjectionManager manager = (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
        if (manager == null) { record("UNAVAILABLE", "MediaProjectionManager indisponível"); finish(); return; }
        try {
            Intent request = Build.VERSION.SDK_INT >= 34
                ? manager.createScreenCaptureIntent(MediaProjectionConfig.createConfigForDefaultDisplay())
                : manager.createScreenCaptureIntent();
            startActivityForResult(request, CONSENT);
        } catch (Exception error) {
            record("CONSENT_ERROR", error.getClass().getSimpleName());
            finish();
        }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, @Nullable Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != CONSENT) return;
        if (resultCode != RESULT_OK || data == null) {
            record("DENIED", "Captura não autorizada pelo usuário");
            finish();
            return;
        }
        try {
            Intent service = new Intent(this, ProOverlayProbeService.class)
                .putExtra("resultCode", resultCode).putExtra("resultData", data);
            ContextCompat.startForegroundService(this, service);
        } catch (Exception error) {
            record("SERVICE_ERROR", error.getClass().getSimpleName());
        }
        finish();
    }

    private void record(String stage, String detail) {
        getSharedPreferences("nvu_overlay_probe", MODE_PRIVATE).edit()
            .putString("stage", stage).putString("detail", detail)
            .putLong("checkedAt", System.currentTimeMillis()).apply();
    }
}
