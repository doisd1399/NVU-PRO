package com.nvu.operacional;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;

public final class NvuPermissionManager {
    private NvuPermissionManager() {}

    public static boolean hasOverlay(Context context) {
        return Settings.canDrawOverlays(context);
    }

    public static void openOverlaySettings(Context context) {
        Intent intent;
        try {
            intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + context.getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
        } catch (Exception e) {
            intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
        }
    }
}
