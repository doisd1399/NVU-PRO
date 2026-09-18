package com.nvu.operacional;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.graphics.Rect;
import android.media.projection.MediaProjectionConfig;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Window;
import android.view.WindowManager;

/** Explicit, one-shot consent host for SimpleAutomation receipt capture. */
public final class SimpleAutomationProjectionPermissionActivity extends Activity {
    private static final int REQUEST_CODE = 4718;
    private static final long LANDSCAPE_SETTLE_MS = 260L;
    private static final long RETRY_MS = 80L;
    private static final int MAX_ATTEMPTS = 40;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private boolean consentLaunched;
    private boolean resultHandled;
    private long landscapeStableSince;
    private int lastWidth;
    private int lastHeight;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        try { setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE); } catch (Exception ignored) {}
        super.onCreate(savedInstanceState);
        overridePendingTransition(0, 0);
        Window window = getWindow();
        window.setBackgroundDrawableResource(android.R.color.transparent);
        window.addFlags(WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
            | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS);
        window.setDimAmount(0f);

        if (savedInstanceState != null) {
            consentLaunched = savedInstanceState.getBoolean("consentLaunched", false);
            landscapeStableSince = savedInstanceState.getLong("landscapeStableSince", 0L);
            lastWidth = savedInstanceState.getInt("lastWidth", 0);
            lastHeight = savedInstanceState.getInt("lastHeight", 0);
        }
        if (!consentLaunched) mainHandler.post(() -> tryLaunch(0));
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        outState.putBoolean("consentLaunched", consentLaunched);
        outState.putLong("landscapeStableSince", landscapeStableSince);
        outState.putInt("lastWidth", lastWidth);
        outState.putInt("lastHeight", lastHeight);
        super.onSaveInstanceState(outState);
    }

    private void tryLaunch(int attempt) {
        if (isFinishing() || consentLaunched) return;
        int[] size = currentDisplaySize();
        int width = size[0];
        int height = size[1];
        boolean landscape = width > height
            && getResources().getConfiguration().orientation == Configuration.ORIENTATION_LANDSCAPE;

        if (!landscape) {
            landscapeStableSince = 0L;
            lastWidth = 0;
            lastHeight = 0;
            try { setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE); } catch (Exception ignored) {}
            if (attempt >= MAX_ATTEMPTS) {
                finish();
                return;
            }
            mainHandler.postDelayed(() -> tryLaunch(attempt + 1), RETRY_MS);
            return;
        }

        long now = System.currentTimeMillis();
        if (width != lastWidth || height != lastHeight) {
            lastWidth = width;
            lastHeight = height;
            landscapeStableSince = now;
            mainHandler.postDelayed(() -> tryLaunch(attempt + 1), RETRY_MS);
            return;
        }
        if (landscapeStableSince <= 0L || now - landscapeStableSince < LANDSCAPE_SETTLE_MS) {
            if (attempt >= MAX_ATTEMPTS) {
                finish();
                return;
            }
            mainHandler.postDelayed(() -> tryLaunch(attempt + 1), RETRY_MS);
            return;
        }

        MediaProjectionManager manager = (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
        if (manager == null) {
            finish();
            return;
        }
        try {
            Intent consent;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                consent = manager.createScreenCaptureIntent(
                    MediaProjectionConfig.createConfigForDefaultDisplay()
                );
            } else {
                consent = manager.createScreenCaptureIntent();
            }
            consent.addFlags(Intent.FLAG_ACTIVITY_NO_ANIMATION);
            consentLaunched = true;
            startActivityForResult(consent, REQUEST_CODE);
        } catch (Exception error) {
            finish();
        }
    }

    @SuppressWarnings("deprecation")
    private int[] currentDisplaySize() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Rect bounds = getWindowManager().getCurrentWindowMetrics().getBounds();
                return new int[] { Math.max(1, bounds.width()), Math.max(1, bounds.height()) };
            }
            android.util.DisplayMetrics metrics = new android.util.DisplayMetrics();
            getWindowManager().getDefaultDisplay().getRealMetrics(metrics);
            return new int[] { Math.max(1, metrics.widthPixels), Math.max(1, metrics.heightPixels) };
        } catch (Exception ignored) {
            return new int[] { 1, 1 };
        }
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        if (newConfig.orientation != Configuration.ORIENTATION_LANDSCAPE) {
            try { setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE); } catch (Exception ignored) {}
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (resultHandled || requestCode != REQUEST_CODE) return;
        resultHandled = true;
        if (resultCode == RESULT_OK && data != null) {
            Intent serviceIntent = new Intent(this, SimpleAutomationService.class)
                .setAction(SimpleAutomationService.ACTION_START_CAPTURE)
                .putExtra(SimpleAutomationService.EXTRA_RESULT_CODE, resultCode)
                .putExtra(SimpleAutomationService.EXTRA_RESULT_DATA, data);
            androidx.core.content.ContextCompat.startForegroundService(this, serviceIntent);
        } else {
            SimpleAutomationService.markCaptureDenied(this);
        }
        finish();
    }

    @Override
    protected void onDestroy() {
        mainHandler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }
}
