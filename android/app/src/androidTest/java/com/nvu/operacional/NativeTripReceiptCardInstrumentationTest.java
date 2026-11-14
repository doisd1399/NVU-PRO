package com.nvu.operacional;

import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Rect;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Device-only typography/layout checks. No auth, capture, submission or production writes. */
@RunWith(AndroidJUnit4.class)
public class NativeTripReceiptCardInstrumentationTest {
    private NativeTripReceipt receipt(String origin, String destination, String earnings) {
        return new NativeTripReceipt(NativeTripReceipt.State.CONFIRMED, "fixture-session",
            "fixture-trip", "fixture-driver", "fixture-company", "fixture-job", "",
            origin, destination, earnings, 3, 12);
    }

    private TextView find(View view, String value) {
        if (view instanceof TextView && value.contentEquals(((TextView) view).getText())) return (TextView) view;
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) {
                TextView result = find(group.getChildAt(i), value);
                if (result != null) return result;
            }
        }
        return null;
    }

    private void verify(float fontScale, int widthDp, NativeTripReceipt.State state,
        String origin, String destination, String value) {
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            Context base = InstrumentationRegistry.getInstrumentation().getTargetContext();
            Configuration config = new Configuration(base.getResources().getConfiguration());
            config.fontScale = fontScale;
            Context context = base.createConfigurationContext(config);
            NativeTripReceipt receipt = state == NativeTripReceipt.State.CONFIRMED
                ? receipt(origin, destination, value)
                : new NativeTripReceipt(state, "fixture-session", "", "fixture-driver",
                    "fixture-company", "fixture-job", "Enviando viagem…", origin, destination, value, 3, 12);
            NativeTripReceiptCardView card = new NativeTripReceiptCardView(context, receipt);
            int width = Math.round(widthDp * context.getResources().getDisplayMetrics().density);
            card.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED));
            card.layout(0, 0, width, card.getMeasuredHeight());
            assertNotNull(find(card, "NVU PRO"));
            TextView heading = find(card, receipt.heading);
            TextView route = find(card, receipt.route());
            assertNotNull(heading);
            assertNotNull(route);
            assertEquals("Heading is a single line", 1, heading.getLineCount());
            assertEquals("Route is a single line", 1, route.getLineCount());
            assertNull(find(card, "Enviando mensagem…"));
            assertNotNull(find(card, "3/12"));
            TextView amount = find(card, value);
            assertNotNull(amount);
            assertEquals(state == NativeTripReceipt.State.CONFIRMED
                ? Color.rgb(40, 189, 145) : Color.rgb(234, 182, 70), amount.getCurrentTextColor());
            Rect bounds = new Rect();
            amount.getDrawingRect(bounds);
            card.offsetDescendantRectToMyCoords(amount, bounds);
            assertTrue("Amount stays inside the native card", bounds.left >= 0 && bounds.right <= width);
            assertEquals("Complete value is laid out", value.length(), amount.getLayout().getLineEnd(
                amount.getLayout().getLineCount() - 1));
            assertEquals("Amount is not truncated", 0, amount.getLayout().getEllipsisCount(0));
            assertEquals("Heading is not truncated", 0, heading.getLayout().getEllipsisCount(0));
            if (fontScale == 1f) {
                assertEquals("Normal route is not truncated", 0, route.getLayout().getEllipsisCount(0));
            }
        });
    }

    @Test public void approvedLandscapeComposition() {
        verify(1f, 440, NativeTripReceipt.State.CONFIRMED, "Nova Macaé", "Itapetuna", "R$ 2.341,00");
    }

    @Test public void pendingUsesSameLayoutWithoutFalseConfirmation() {
        verify(1f, 440, NativeTripReceipt.State.PENDING, "Nova Macaé", "Itapetuna", "R$ 2.341,00");
    }

    @Test public void narrowSafeAreaAndLargerFonts() {
        verify(1f, 320, NativeTripReceipt.State.CONFIRMED, "Agro Grão", "Registro", "R$ 34.377,00");
        verify(1.3f, 360, NativeTripReceipt.State.PENDING, "Agro Grão", "Registro", "R$ 34.377,00");
    }

    @Test public void longRouteAndEuroValueAtLargeFont() {
        verify(2f, 440, NativeTripReceipt.State.CONFIRMED, "Empresa de origem com nome extenso", "Destino de entrega com nome extenso", "€ 1.234.567,89");
    }
}
