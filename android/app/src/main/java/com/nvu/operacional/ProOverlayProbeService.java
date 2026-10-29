package com.nvu.operacional;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.DisplayMetrics;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.view.WindowManager;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

/** User-authorized projection session that supplies a temporary overlay grant to Pro. */
public final class ProOverlayProbeService extends Service {
    private static final String CHANNEL = "nvu_overlay_probe";
    private final Handler main = new Handler(Looper.getMainLooper());
    private MediaProjection projection;
    private VirtualDisplay display;
    private ImageReader reader;
    private HandlerThread frameThread;
    private Handler frameHandler;
    private int frameWidth;
    private int frameHeight;
    private volatile SimpleAutomationService receiptOwner;
    private volatile boolean finished;
    private volatile boolean ready;
    private static volatile ProOverlayProbeService active;
    public static boolean isActive() { return active != null && active.ready && !active.finished; }
    /** Consume receipt frames from the existing authorized virtual display. */
    public static boolean beginReceiptCapture(SimpleAutomationService owner) {
        ProOverlayProbeService session = active;
        return session != null && session.ready && session.attachReceiptReader(owner);
    }

    public static void endReceiptCapture(SimpleAutomationService owner) {
        ProOverlayProbeService session = active;
        if (session != null) session.detachReceiptReader(owner);
    }

    private boolean attachReceiptReader(SimpleAutomationService owner) {
        if (owner == null || finished || reader == null || display == null || projection == null) return false;
        if (receiptOwner != null && receiptOwner != owner) return false;
        try {
            DisplayMetrics metrics = new DisplayMetrics();
            WindowManager windows = (WindowManager) getSystemService(WINDOW_SERVICE);
            if (windows == null) return false;
            windows.getDefaultDisplay().getRealMetrics(metrics);
            int width = Math.max(1, metrics.widthPixels);
            int height = Math.max(1, metrics.heightPixels);
            if (width != frameWidth || height != frameHeight) {
                ImageReader next = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2);
                ImageReader previous = reader;
                display.resize(width, height, Math.max(1, metrics.densityDpi));
                display.setSurface(next.getSurface());
                reader = next;
                frameWidth = width;
                frameHeight = height;
                previous.setOnImageAvailableListener(null, null);
                previous.close();
            }
            receiptOwner = owner;
            reader.setOnImageAvailableListener(source -> {
                SimpleAutomationService current = receiptOwner;
                if (current == owner && !finished) current.consumeTemporaryCaptureFrame(source, frameWidth, frameHeight);
                else discardFrame(source);
            }, owner.getReceiptCaptureHandler());
            return true;
        } catch (Exception error) {
            receiptOwner = null;
            if (reader != null) reader.setOnImageAvailableListener(this::discardFrame, frameHandler);
            android.util.Log.w("NVU-Pro", "Falha ao reutilizar projeção", error);
            return false;
        }
    }

    private void detachReceiptReader(SimpleAutomationService owner) {
        if (receiptOwner != owner) return;
        receiptOwner = null;
        if (!finished && reader != null) reader.setOnImageAvailableListener(this::discardFrame, frameHandler);
    }

    private void discardFrame(ImageReader source) {
        Image frame = null;
        try { frame = source.acquireLatestImage(); }
        catch (Exception ignored) {}
        finally { if (frame != null) frame.close(); }
    }

    public static void stopSession(android.content.Context context) {
        if (context != null) context.getApplicationContext().stopService(
            new Intent(context.getApplicationContext(), ProOverlayProbeService.class));
    }

    @Nullable @Override public IBinder onBind(Intent intent) { return null; }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        active = this;
        frameThread = new HandlerThread("nvu-pro-projection-frames");
        frameThread.start();
        frameHandler = new Handler(frameThread.getLooper());
        record("STARTING", "Iniciando captura autorizada");
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null) nm.createNotificationChannel(new NotificationChannel(
                CHANNEL, "Bolha temporária NVU", NotificationManager.IMPORTANCE_LOW));
        }
        Notification notification = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setContentTitle("NVU: Modo Pro com bolha temporária")
            .setContentText("Captura autorizada ativa enquanto o Modo Pro está em uso")
            .setOngoing(true)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Encerrar Modo Pro",
                PendingIntent.getService(this, 3939,
                    new Intent(this, SimpleAutomationService.class).setAction(SimpleAutomationService.ACTION_STOP),
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE))
            .build();
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(3939, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
            } else startForeground(3939, notification);
            Intent data = intent == null ? null : intent.getParcelableExtra("resultData");
            if (data == null) throw new IllegalStateException("Autorização ausente");
            MediaProjectionManager manager = (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
            if (manager == null) throw new IllegalStateException("MediaProjection indisponível");
            projection = manager.getMediaProjection(intent.getIntExtra("resultCode", 0), data);
            if (projection == null) throw new IllegalStateException("Captura não iniciada");
            projection.registerCallback(new MediaProjection.Callback() {
                @Override public void onStop() {
                    ready = false;
                    main.post(() -> finish("STOPPED", "Captura encerrada pelo Android"));
                }
            }, main);
            DisplayMetrics metrics = new DisplayMetrics();
            WindowManager windows = (WindowManager) getSystemService(WINDOW_SERVICE);
            if (windows == null) throw new IllegalStateException("Tela indisponível");
            windows.getDefaultDisplay().getRealMetrics(metrics);
            int width = Math.max(1, metrics.widthPixels);
            int height = Math.max(1, metrics.heightPixels);
            frameWidth = width;
            frameHeight = height;
            reader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2);
            reader.setOnImageAvailableListener(this::discardFrame, frameHandler);
            display = projection.createVirtualDisplay("NVU Pro temporary overlay",
                width, height, Math.max(1, metrics.densityDpi),
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, reader.getSurface(), null, main);
            boolean granted = Settings.canDrawOverlays(this);
            if (!granted) {
                finish("NOT_GRANTED", "O Android não concedeu sobreposição temporária nesta instalação");
            } else {
                ready = true;
                record("OVERLAY_OK", "Captura ativa; autorização temporária de sobreposição disponível");
            }

        } catch (Exception error) {
            finish("CAPTURE_FAILED", error.getClass().getSimpleName());
        }
        return START_NOT_STICKY;
    }

    private void record(String stage, String detail) {
        getSharedPreferences("nvu_overlay_probe", MODE_PRIVATE).edit()
            .putString("stage", stage).putString("detail", detail)
            .putLong("checkedAt", System.currentTimeMillis()).apply();
    }

    private void finish(String stage, String detail) {
        if (finished) return;
        finished = true;
        ready = false;
        if (stage != null) record(stage, detail);
        stopSelf();
    }

    @Override public void onDestroy() {
        if (active == this) active = null;
        finished = true;
        ready = false;
        receiptOwner = null;
        main.removeCallbacksAndMessages(null);
        if (display != null) display.release();
        if (reader != null) { reader.setOnImageAvailableListener(null, null); reader.close(); }
        if (projection != null) projection.stop();
        if (frameThread != null) frameThread.quitSafely();
        if (getSharedPreferences("nvu_overlay_probe", MODE_PRIVATE).getString("stage", "").equals("OVERLAY_OK"))
            record("STOPPED", "Captura temporária encerrada");
        SimpleAutomationService.onTemporaryOverlayEnded();
        stopForeground(STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }
}
