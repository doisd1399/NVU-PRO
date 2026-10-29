package com.nvu.operacional;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.webkit.WebView;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/** One bounded, sanitized report outside WebView storage. No trip/network writes. */
@CapacitorPlugin(name = "PrintDiagnostics")
public final class PrintDiagnosticsPlugin extends Plugin {
    private SharedPreferences prefs() {
        return getContext().getSharedPreferences("nvu_print_diagnostic", Context.MODE_PRIVATE);
    }
    private String owner(PluginCall call) throws Exception {
        String id = call.getString("ownerId", "");
        if (id.isEmpty() || id.length() > 256) throw new IllegalArgumentException("DIAGNOSTIC_OWNER_REQUIRED");
        byte[] hash = MessageDigest.getInstance("SHA-256").digest(id.getBytes(StandardCharsets.UTF_8));
        StringBuilder result = new StringBuilder();
        for (byte value : hash) result.append(String.format("%02x", value & 0xff));
        return result.toString();
    }
    private String report(PluginCall call) {
        String text = call.getString("text", "");
        if (text.length() > 20000 || !text.contains("NVU_PRINT_517_1")) throw new IllegalArgumentException("DIAGNOSTIC_INVALID");
        return text;
    }
    @PluginMethod public void getRuntimeInfo(PluginCall call) {
        JSObject result = new JSObject();
        result.put("nativeVersion", BuildConfig.VERSION_NAME);
        result.put("versionCode", BuildConfig.VERSION_CODE);
        result.put("android", Build.VERSION.RELEASE);
        result.put("model", Build.MANUFACTURER + " " + Build.MODEL);
        if (Build.VERSION.SDK_INT >= 26) {
            PackageInfo info = WebView.getCurrentWebViewPackage();
            if (info != null) result.put("webView", info.packageName + " " + info.versionName);
        }
        call.resolve(result);
    }
    @PluginMethod public void saveReport(PluginCall call) {
        try {
            boolean saved = prefs().edit().putString("owner", owner(call)).putString("text", report(call)).commit();
            if (!saved) { call.reject("DIAGNOSTIC_SAVE_FAILED"); return; }
            call.resolve();
        } catch (Exception error) { call.reject("DIAGNOSTIC_SAVE_FAILED", error); }
    }
    @PluginMethod public void readReport(PluginCall call) {
        try {
            JSObject result = new JSObject();
            result.put("text", owner(call).equals(prefs().getString("owner", "")) ? prefs().getString("text", "") : "");
            call.resolve(result);
        } catch (Exception error) { call.reject("DIAGNOSTIC_READ_FAILED", error); }
    }
    @PluginMethod public void shareReport(PluginCall call) {
        try {
            String text = report(call);
            getActivity().runOnUiThread(() -> {
                try {
                    Intent intent = new Intent(Intent.ACTION_SEND);
                    intent.setType("text/plain");
                    intent.putExtra(Intent.EXTRA_TEXT, text);
                    getActivity().startActivity(Intent.createChooser(intent, "Compartilhar diagnóstico NVU"));
                    call.resolve();
                } catch (Exception error) { call.reject("DIAGNOSTIC_SHARE_FAILED", error); }
            });
        } catch (Exception error) { call.reject("DIAGNOSTIC_SHARE_FAILED", error); }
    }
}
