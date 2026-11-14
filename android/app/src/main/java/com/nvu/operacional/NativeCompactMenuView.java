package com.nvu.operacional;

import android.content.Context;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.view.MotionEvent;
import android.widget.LinearLayout;
import java.util.function.BooleanSupplier;

/** Pro/Max menu surface: content starts at the inset, with no reserved close row. */
final class NativeCompactMenuView extends LinearLayout {
    NativeCompactMenuView(Context context) {
        super(context);
        float density = getResources().getDisplayMetrics().density;
        int inset = Math.round(8 * density);
        setOrientation(VERTICAL);
        setPadding(inset, inset, inset, inset);
        GradientDrawable background = new GradientDrawable();
        background.setColor(Color.argb(214, 28, 31, 36));
        background.setCornerRadius(Math.round(14 * density));
        setBackground(background);
        setElevation(Math.round(6 * density));
    }

    static void bindOutsideDismiss(LinearLayout surface, BooleanSupplier isCurrent, Runnable close) {
        surface.setOnTouchListener((view, event) -> {
            if (event != null && event.getActionMasked() == MotionEvent.ACTION_OUTSIDE && isCurrent.getAsBoolean()) {
                close.run();
            }
            // Outside notifications do not consume the simulator's gesture;
            // normal inside events still reach menu buttons and scrolling.
            return false;
        });
    }

    static int controlExtent(Context context, int normalDp) {
        float density = context.getResources().getDisplayMetrics().density;
        float fontScale = context.getResources().getDisplayMetrics().scaledDensity / Math.max(0.1f, density);
        return Math.round(normalDp * density * Math.max(1f, fontScale));
    }
}
