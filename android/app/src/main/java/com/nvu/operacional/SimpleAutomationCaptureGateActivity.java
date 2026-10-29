package com.nvu.operacional;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Legacy compatibility activity. The current Pro completion flow no longer
 * reopens NVU: finalization relaunches only the configured simulator and then
 * requests Android capture consent automatically. Kept for binary/manifest
 * compatibility with older installs; it is not part of the current finish path.
 */
public final class SimpleAutomationCaptureGateActivity extends Activity {
    private boolean handled;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        buildUi();
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setPadding(dp(28), dp(28), dp(28), dp(28));
        root.setBackgroundColor(Color.WHITE);

        TextView title = new TextView(this);
        title.setText("Finalizar viagem Pro");
        title.setTextSize(22f);
        title.setTextColor(Color.rgb(24, 29, 38));
        title.setGravity(Gravity.CENTER);
        root.addView(title, new LinearLayout.LayoutParams(-1, -2));

        TextView message = new TextView(this);
        message.setText("O simulador do Modo Pro será reaberto diretamente para capturar o resultado. A confirmação de captura do Android aparecerá em seguida. Este fluxo não reabre o NVU.");
        message.setTextSize(15f);
        message.setTextColor(Color.rgb(92, 98, 108));
        message.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams messageParams = new LinearLayout.LayoutParams(-1, -2);
        messageParams.topMargin = dp(18);
        root.addView(message, messageParams);

        Button continueButton = new Button(this);
        continueButton.setText("Continuar e capturar resultado");
        continueButton.setAllCaps(false);
        continueButton.setOnClickListener(v -> confirm());
        LinearLayout.LayoutParams continueParams = new LinearLayout.LayoutParams(-1, -2);
        continueParams.topMargin = dp(24);
        root.addView(continueButton, continueParams);

        Button cancelButton = new Button(this);
        cancelButton.setText("Cancelar");
        cancelButton.setAllCaps(false);
        cancelButton.setOnClickListener(v -> cancel());
        LinearLayout.LayoutParams cancelParams = new LinearLayout.LayoutParams(-1, -2);
        cancelParams.topMargin = dp(8);
        root.addView(cancelButton, cancelParams);

        setContentView(root);
    }

    private void confirm() {
        if (handled) return;
        handled = true;
        SimpleAutomationService.confirmReceiptCaptureReentry(this);
        finish();
    }

    private void cancel() {
        if (handled) return;
        handled = true;
        SimpleAutomationService.cancelReceiptCaptureReentry(this);
        finish();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
