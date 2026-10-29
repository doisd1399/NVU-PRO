package com.nvu.operacional;

import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Rect;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import java.io.File;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.List;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;
import static org.junit.Assert.*;

/** Real Android 15 TextView/LinearLayout measurement, using native graphics. */
@RunWith(RobolectricTestRunner.class)
@Config(manifest = Config.NONE, sdk = 35, qualifiers = "w1024dp-h460dp-land-hdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class NativeReceiptLayout494Test {
    private List<TextView> texts(View v) {
        List<TextView> out = new ArrayList<>();
        if (v instanceof TextView) out.add((TextView) v);
        if (v instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) v;
            for (int i = 0; i < group.getChildCount(); i++) out.addAll(texts(group.getChildAt(i)));
        }
        return out;
    }

    private NativeTripReceiptCardView layout(float font, int widthDp, boolean pending, boolean longRoute) {
        Context app = RuntimeEnvironment.getApplication();
        Configuration config = new Configuration(app.getResources().getConfiguration());
        config.fontScale = font;
        Context context = app.createConfigurationContext(config);
        NativeTripReceipt receipt = new NativeTripReceipt(pending ? NativeTripReceipt.State.PENDING : NativeTripReceipt.State.CONFIRMED,
            "fixture", "trip", "driver", "company", "job", "Enviando viagem…",
            longRoute ? "Empresa de origem com nome extenso" : "Nova Macaé",
            longRoute ? "Destino de entrega com nome extenso" : "Itapetuna",
            longRoute ? "€ 1.234.567,89" : "R$ 2.341,00", 6, 12);
        NativeTripReceiptCardView card = new NativeTripReceiptCardView(context, receipt);
        int width = Math.round(widthDp * context.getResources().getDisplayMetrics().density);
        card.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED));
        card.layout(0, 0, width, card.getMeasuredHeight());
        return card;
    }

    private void verify(NativeTripReceiptCardView card, boolean requireFullRoute) {
        List<TextView> fields = texts(card);
        List<Rect> bounds = new ArrayList<>();
        for (TextView text : fields) {
            assertEquals(text.getText() + " stays on one line", 1, text.getLineCount());
            assertFalse("No unrelated message", text.getText().toString().contains("Enviando mensagem"));
            Rect rect = new Rect(); text.getDrawingRect(rect);
            card.offsetDescendantRectToMyCoords(text, rect);
            assertTrue(text.getText() + " horizontal bounds " + rect,
                rect.left >= 0 && rect.right <= card.getWidth() && rect.width() > 0);
            assertTrue(text.getText() + " vertical bounds " + rect,
                rect.top >= 0 && rect.bottom <= card.getHeight());
            for (Rect other : bounds) assertFalse("Text fields must not overlap", Rect.intersects(rect, other));
            bounds.add(rect);
            if (requireFullRoute || !text.getText().toString().equals(card.receipt.route())) {
                assertEquals(text.getText() + " is not truncated", 0, text.getLayout().getEllipsisCount(0));
            }
        }
        assertEquals(7, fields.size());
        assertTrue(fields.stream().anyMatch(t -> t.getText().toString().equals(card.receipt.heading)));
        assertTrue(fields.stream().anyMatch(t -> t.getText().toString().equals(card.receipt.route())));
        assertTrue(fields.stream().anyMatch(t -> t.getText().toString().equals(card.receipt.earnings)));
    }

    private void render(String name, NativeTripReceiptCardView card) throws Exception {
        File dir = new File(System.getProperty("nvu.qa.output")); dir.mkdirs();
        Bitmap bitmap = Bitmap.createBitmap(card.getWidth(), card.getHeight(), Bitmap.Config.ARGB_8888);
        card.draw(new Canvas(bitmap));
        try (FileOutputStream stream = new FileOutputStream(new File(dir, name + ".png"))) {
            assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream));
        }
    }

    @Test public void approvedConfirmed() throws Exception {
        NativeTripReceiptCardView card = layout(1f, 440, false, false);
        verify(card, true); render("confirmed", card);
    }

    @Test public void approvedSending() throws Exception {
        NativeTripReceiptCardView card = layout(1f, 440, true, false);
        verify(card, true); render("sending", card);
    }

    @Test public void narrowSafeArea() {
        for (int width : new int[]{240, 280, 320, 360}) verify(layout(1f, width, false, false), true);
    }

    @Test public void largerFonts() throws Exception {
        for (float font : new float[]{1.3f, 1.5f, 2f}) {
            NativeTripReceiptCardView card = layout(font, 440, true, false);
            verify(card, true); render("font-" + font, card);
        }
    }

    @Test public void longRouteAtLargeFont() throws Exception {
        NativeTripReceiptCardView card = layout(2f, 440, false, true);
        verify(card, false); render("long-route", card);
    }

    @Test public void resizeDoesNotLeaveStaleStacking() {
        NativeTripReceiptCardView card = layout(1f, 440, false, false);
        int originalHeight = card.getHeight();
        for (int width : new int[]{360, 280, 440}) {
            int px = Math.round(width * card.getResources().getDisplayMetrics().density);
            card.measure(View.MeasureSpec.makeMeasureSpec(px, View.MeasureSpec.EXACTLY), 0);
            card.layout(0, 0, px, card.getMeasuredHeight());
            verify(card, true);
        }
        assertEquals(originalHeight, card.getHeight());
    }
}
