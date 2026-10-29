package com.nvu.operacional;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import static org.junit.Assert.*;

/** Invoked in two independent instrumentation processes by the host QA runner. */
@RunWith(AndroidJUnit4.class)
public class QaOfflineSmokeTest {
    private Context context() { return InstrumentationRegistry.getInstrumentation().getTargetContext(); }
    private void isolated() {
        assertEquals("com.nvu.operacional.qa", context().getPackageName());
        assertEquals(PackageManager.PERMISSION_DENIED, context().checkSelfPermission(Manifest.permission.INTERNET));
    }
    private void opensBundledWeb() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            long deadline = System.currentTimeMillis() + 45000;
            AtomicBoolean rendered = new AtomicBoolean(false);
            while (!rendered.get() && System.currentTimeMillis() < deadline) {
                CountDownLatch latch = new CountDownLatch(1);
                scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(
                    "Boolean(document.getElementById('root') && document.getElementById('root').childElementCount > 0 && !document.querySelector('[data-nvu-initial-boot]') && !document.body.innerText.includes('Não foi possível preparar o aplicativo') && Array.from(document.querySelectorAll('button')).some(b => !b.disabled && (b.innerText.includes('Fazer Login') || b.innerText.includes('Entrar com Google'))))",
                    value -> { rendered.set("true".equals(value)); latch.countDown(); }));
                latch.await(5, TimeUnit.SECONDS);
                if (!rendered.get()) Thread.sleep(200);
            }
            assertTrue("The real bundled app must render offline without a blank WebView", rendered.get());
        }
    }
    @Test public void firstBoot() throws Exception {
        isolated(); opensBundledWeb();
        assertTrue(context().getSharedPreferences("qa-process-restart", 0).edit().putString("sentinel", "preserved").commit());
    }
    @Test public void afterProcessRestart() throws Exception {
        isolated();
        assertEquals("preserved", context().getSharedPreferences("qa-process-restart", 0).getString("sentinel", ""));
        opensBundledWeb();
    }
}
