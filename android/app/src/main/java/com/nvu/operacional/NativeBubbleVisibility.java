package com.nvu.operacional;

import android.view.View;
import android.view.WindowManager;

/** Hides a window without detaching it or changing the user's coordinates. */
final class NativeBubbleVisibility {
    private View target;
    private int originalTouchFlag;

    void apply(View view, WindowManager.LayoutParams params, WindowManager manager, boolean visible) {
        if (view == null || params == null) return;
        if (target != view) {
            target = view;
            originalTouchFlag = params.flags & WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
        }
        int flags = visible
            ? (params.flags & ~WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE) | originalTouchFlag
            : params.flags | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
        int visibility = visible ? View.VISIBLE : View.INVISIBLE;
        boolean changed = params.flags != flags || view.getVisibility() != visibility;
        params.flags = flags;
        view.setVisibility(visibility);
        if (changed && manager != null && view.isAttachedToWindow()) {
            try { manager.updateViewLayout(view, params); } catch (RuntimeException ignored) {}
        }
    }
}
