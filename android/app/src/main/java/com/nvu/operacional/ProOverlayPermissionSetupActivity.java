package com.nvu.operacional;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;

/** Guided Android settings flow for the persistent Pro bubble permission. */
public final class ProOverlayPermissionSetupActivity extends Activity {
    private static final int REQUEST_OVERLAY_FIRST = 4111;
    private static final int REQUEST_APP_INFO = 4112;
    private static final int REQUEST_OVERLAY_AGAIN = 4113;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        if (state != null) {
            // Do not restart a settings flow after the OS recreates this Activity.
            finish();
            return;
        }
        if (Settings.canDrawOverlays(this)) { finish(); return; }
        showFirstStep();
    }

    private void showFirstStep() {
        new AlertDialog.Builder(this)
            .setTitle("Ativar a bolha NVU")
            .setMessage("Na tela do Android, selecione NVU e tente ativar ‘Sobrepor a outros apps’. "
                + "Se aparecer um aviso de configuração restrita, volte à NVU para o próximo passo.")
            .setPositiveButton("Abrir sobreposição", (dialog, which) -> openOverlay(REQUEST_OVERLAY_FIRST))
            .setNegativeButton("Agora não", (dialog, which) -> finish())
            .setOnCancelListener(dialog -> finish())
            .show();
    }

    private void showAppInfoStep() {
        if (Settings.canDrawOverlays(this)) { finish(); return; }
        new AlertDialog.Builder(this)
            .setTitle("Desbloquear o interruptor")
            .setMessage("O Android ainda não autorizou a sobreposição. Abra as informações da NVU, "
                + "toque no menu ⋮ e escolha ‘Permitir configurações restritas’. "
                + "Confirme com o bloqueio de tela e volte à NVU. Essa decisão é feita na tela do Android.")
            .setPositiveButton("Abrir informações da NVU", (dialog, which) -> openAppInfo())
            .setNegativeButton("Agora não", (dialog, which) -> finish())
            .setOnCancelListener(dialog -> finish())
            .show();
    }

    private void showFinalStep() {
        if (Settings.canDrawOverlays(this)) { finish(); return; }
        new AlertDialog.Builder(this)
            .setTitle("Ligar a sobreposição")
            .setMessage("Volte à tela ‘Sobrepor a outros apps’, selecione NVU e ligue o interruptor. "
                + "Depois volte ao aplicativo e toque novamente em Modo Pro.")
            .setPositiveButton("Abrir sobreposição", (dialog, which) -> openOverlay(REQUEST_OVERLAY_AGAIN))
            .setNegativeButton("Agora não", (dialog, which) -> finish())
            .setOnCancelListener(dialog -> finish())
            .show();
    }

    private void showStillBlocked() {
        new AlertDialog.Builder(this)
            .setTitle("Sobreposição ainda desativada")
            .setMessage("O Android não liberou a bolha da NVU. Confira se ‘Permitir configurações restritas’ "
                + "foi confirmado nas informações do app e tente novamente.")
            .setPositiveButton("Repetir", (dialog, which) -> showFirstStep())
            .setNegativeButton("Fechar", (dialog, which) -> finish())
            .setOnCancelListener(dialog -> finish())
            .show();
    }

    private void openOverlay(int requestCode) {
        try {
            // Android 11+ ignores a package URI here and may show the full app list.
            startActivityForResult(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION), requestCode);
        } catch (Exception error) {
            showStillBlocked();
        }
    }

    private void openAppInfo() {
        try {
            startActivityForResult(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:" + getPackageName())), REQUEST_APP_INFO);
        } catch (Exception error) {
            showStillBlocked();
        }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        ProModeController.validateOverlayAtEntry(this);
        if (Settings.canDrawOverlays(this)) { finish(); return; }
        if (requestCode == REQUEST_OVERLAY_FIRST) showAppInfoStep();
        else if (requestCode == REQUEST_APP_INFO) showFinalStep();
        else if (requestCode == REQUEST_OVERLAY_AGAIN) showStillBlocked();
    }
}
