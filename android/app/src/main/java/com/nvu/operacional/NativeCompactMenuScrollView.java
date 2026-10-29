package com.nvu.operacional;

import android.content.Context;
import android.view.View;
import android.widget.ScrollView;
import java.util.function.IntSupplier;

/** Re-evaluates available space on every measure, including font/rotation changes. */
final class NativeCompactMenuScrollView extends ScrollView {
    private final IntSupplier availableHeight;

    NativeCompactMenuScrollView(Context context, IntSupplier availableHeight) {
        super(context);
        this.availableHeight = availableHeight;
    }

    @Override protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
        int available = Math.max(1, availableHeight.getAsInt());
        int mode = View.MeasureSpec.getMode(heightMeasureSpec);
        int height = mode == View.MeasureSpec.UNSPECIFIED ? available
            : Math.min(available, View.MeasureSpec.getSize(heightMeasureSpec));
        super.onMeasure(widthMeasureSpec, View.MeasureSpec.makeMeasureSpec(height,
            mode == View.MeasureSpec.EXACTLY ? View.MeasureSpec.EXACTLY : View.MeasureSpec.AT_MOST));
    }
}
