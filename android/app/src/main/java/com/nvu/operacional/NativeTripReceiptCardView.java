package com.nvu.operacional;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Insets;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.hardware.input.InputManager;
import android.os.Build;
import android.text.TextUtils;
import android.util.DisplayMetrics;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.view.WindowInsets;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Native two-row receipt matching the approved NVU mockup. No WebView or bitmap text. */
final class NativeTripReceiptCardView extends LinearLayout {
    private static final int MUTED = Color.rgb(157, 173, 184);
    private static final int WHITE = Color.rgb(245, 248, 250);
    private static final int GREEN = Color.rgb(40, 189, 145);
    private static final int DIVIDER = Color.argb(160, 63, 78, 89);
    final NativeTripReceipt receipt;
    private final LinearLayout header, identity, gains, footer, route, progress;
    private final TextView brand, heading, gainsLabel, amount, routeText, progressLabel, counter;
    private final View headerDivider, footerDivider;
    private boolean rowsPrepared, headerStacked, footerStacked;

    NativeTripReceiptCardView(Context context, NativeTripReceipt receipt) {
        super(context);
        this.receipt = receipt;
        int accent = receipt.state == NativeTripReceipt.State.CONFIRMED
            ? GREEN : Color.rgb(234, 182, 70);
        setOrientation(VERTICAL);
        setPadding(dp(12), dp(12), dp(12), dp(10));
        GradientDrawable surface = new GradientDrawable();
        surface.setColor(Color.rgb(19, 28, 33));
        surface.setCornerRadius(dp(11));
        surface.setStroke(dp(1), Color.argb(150, Color.red(accent), Color.green(accent), Color.blue(accent)));
        setBackground(surface);
        setElevation(dp(5));

        header = row();
        identity = row();
        IconView check = new IconView(context, receipt.state == NativeTripReceipt.State.CONFIRMED
            ? IconView.CHECK : IconView.CLOCK, accent);
        identity.addView(check, new LayoutParams(dp(32), dp(32)));

        LinearLayout title = new LinearLayout(context);
        title.setOrientation(VERTICAL);
        title.setPadding(dp(12), 0, dp(6), 0);
        brand = text("NVU PRO", 9.5f, MUTED, false);
        heading = text(receipt.heading, 14f, WHITE, true);
        title.addView(brand);
        title.addView(heading);
        identity.addView(title, new LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f));
        header.addView(identity, new LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f));

        gains = new LinearLayout(context);
        gains.setOrientation(VERTICAL);
        gains.setGravity(Gravity.START);
        gainsLabel = text("Ganhos", 9.5f, MUTED, false);
        amount = text(receipt.earnings, 14f, accent, true);
        gains.addView(gainsLabel);
        gains.addView(amount);
        headerDivider = verticalDivider(29, 12);
        header.addView(headerDivider);
        header.addView(gains, new LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT));
        addView(header, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));

        View line = new View(context);
        line.setBackgroundColor(DIVIDER);
        LayoutParams lineParams = new LayoutParams(LayoutParams.MATCH_PARENT, dp(1));
        lineParams.topMargin = dp(7);
        lineParams.bottomMargin = dp(6);
        addView(line, lineParams);

        footer = row();
        route = row();
        route.setPadding(dp(3), 0, 0, 0);
        route.addView(new IconView(context, IconView.LOCATION, WHITE), new LayoutParams(dp(15), dp(17)));
        routeText = text(receipt.route(), 12f, WHITE, false);
        LayoutParams routeTextParams = new LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f);
        routeTextParams.leftMargin = dp(8);
        route.addView(routeText, routeTextParams);
        footer.addView(route, new LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f));

        progress = row();
        progressLabel = text("Operação atual", 9f, MUTED, false);
        progress.addView(progressLabel);
        counter = text(receipt.counter(), 10f, WHITE, false);
        LayoutParams counterParams = new LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT);
        counterParams.leftMargin = dp(6);
        counterParams.rightMargin = dp(8);
        progress.addView(counter, counterParams);
        View bar = new ProgressTrack(context, receipt.fraction(), accent);
        bar.setContentDescription(receipt.total > 0
            ? Math.round(receipt.fraction() * 100) + "% confirmado" : "Progresso indisponível");
        progress.addView(bar, new LayoutParams(dp(54), dp(5)));
        footerDivider = verticalDivider(13, 9);
        footer.addView(footerDivider);
        LayoutParams progressParams = new LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT);
        footer.addView(progress, progressParams);
        addView(footer, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        setContentDescription(receipt.heading + ". " + receipt.route() + ". Ganhos "
            + receipt.earnings + ". Operação atual " + receipt.counter());
    }

    @Override protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
        if (View.MeasureSpec.getMode(widthMeasureSpec) != View.MeasureSpec.UNSPECIFIED) {
            int available = Math.max(1, View.MeasureSpec.getSize(widthMeasureSpec)
                - getPaddingLeft() - getPaddingRight());
            // Measure at the requested font sizes, not a previous auto-sized pass.
            // A long route or an accessibility font moves the progress below it
            // instead of wrapping either the route or the status heading.
            float headerWidth = dp(50) + Math.max(preferredWidth(brand, 9.5f), preferredWidth(heading, 14f))
                + dp(25) + Math.max(preferredWidth(gainsLabel, 9.5f), preferredWidth(amount, 14f));
            boolean stackHeader = headerWidth > available;
            if (!rowsPrepared || stackHeader != headerStacked) {
                headerStacked = stackHeader;
                header.setOrientation(stackHeader ? VERTICAL : HORIZONTAL);
                identity.setLayoutParams(new LayoutParams(stackHeader ? LayoutParams.MATCH_PARENT : 0,
                    LayoutParams.WRAP_CONTENT, stackHeader ? 0f : 1f));
                headerDivider.setVisibility(stackHeader ? GONE : VISIBLE);
                LayoutParams gainsParams = new LayoutParams(stackHeader ? LayoutParams.MATCH_PARENT : LayoutParams.WRAP_CONTENT,
                    LayoutParams.WRAP_CONTENT);
                gainsParams.topMargin = stackHeader ? dp(6) : 0;
                gains.setLayoutParams(gainsParams);
            }

            float footerWidth = dp(26) + preferredWidth(routeText, 12f) + dp(19 + 68)
                + preferredWidth(progressLabel, 9f) + preferredWidth(counter, 10f);
            boolean stackFooter = footerWidth > available;
            if (!rowsPrepared || stackFooter != footerStacked) {
                footerStacked = stackFooter;
                footer.setOrientation(stackFooter ? VERTICAL : HORIZONTAL);
                route.setLayoutParams(new LayoutParams(stackFooter ? LayoutParams.MATCH_PARENT : 0,
                    LayoutParams.WRAP_CONTENT, stackFooter ? 0f : 1f));
                footerDivider.setVisibility(stackFooter ? GONE : VISIBLE);
                LayoutParams progressParams = new LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT);
                progressParams.topMargin = stackFooter ? dp(6) : 0;
                progress.setLayoutParams(progressParams);
            }
            rowsPrepared = true;
        }
        super.onMeasure(widthMeasureSpec, heightMeasureSpec);
    }

    private float preferredWidth(TextView view, float sizeSp) {
        Paint measure = new Paint(view.getPaint());
        measure.setTextSize(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, sizeSp,
            getResources().getDisplayMetrics()));
        return measure.measureText(view.getText().toString());
    }

    private LinearLayout row() {
        LinearLayout row = new LinearLayout(getContext());
        row.setOrientation(HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        return row;
    }

    private View verticalDivider(int height, int margin) {
        View divider = new View(getContext());
        divider.setBackgroundColor(DIVIDER);
        LayoutParams params = new LayoutParams(dp(1), dp(height));
        params.leftMargin = dp(margin);
        params.rightMargin = dp(margin);
        divider.setLayoutParams(params);
        return divider;
    }

    private TextView text(String value, float size, int color, boolean bold) {
        TextView text = new TextView(getContext());
        text.setText(value);
        text.setTextSize(size);
        text.setTextColor(color);
        text.setIncludeFontPadding(false);
        text.setSingleLine(true);
        text.setMaxLines(1);
        text.setEllipsize(TextUtils.TruncateAt.END);
        text.setHorizontallyScrolling(false);
        if (bold) text.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && size >= 12f) {
            text.setAutoSizeTextTypeUniformWithConfiguration(10, Math.round(size), 1, TypedValue.COMPLEX_UNIT_SP);
        }
        return text;
    }

    private int dp(float value) { return Math.max(1, Math.round(value * getResources().getDisplayMetrics().density)); }

    static void position(Context context, View view, WindowManager.LayoutParams params,
        DisplayMetrics screen, int safeLeft, int safeTop, int safeRightInset, int safeBottomInset) {
        params.gravity = Gravity.TOP | Gravity.LEFT;
        params.width = NativeReceiptCardLayoutPolicy.width(screen.widthPixels,
            safeLeft, safeRightInset, screen.density);
        params.x = NativeReceiptCardLayoutPolicy.x(screen.widthPixels, safeLeft, safeRightInset, params.width);
        int height = view.getHeight() > 0 ? view.getHeight() : Math.round(85 * screen.density);
        params.y = NativeReceiptCardLayoutPolicy.y(screen.heightPixels, safeTop, safeBottomInset, height);
        applyPassThroughOpacity(context, params);
    }

    static int[] safeHorizontalInsets(WindowManager manager) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && manager != null) {
            try {
                Insets insets = manager.getCurrentWindowMetrics().getWindowInsets()
                    .getInsetsIgnoringVisibility(WindowInsets.Type.displayCutout() | WindowInsets.Type.navigationBars());
                return new int[]{Math.max(0, insets.left), Math.max(0, insets.right)};
            } catch (RuntimeException ignored) {}
        }
        return new int[]{0, 0};
    }

    static void applyPassThroughOpacity(Context context, WindowManager.LayoutParams params) {
        float limit = 0.8f;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            InputManager manager = (InputManager) context.getSystemService(Context.INPUT_SERVICE);
            if (manager != null) limit = Math.min(limit, manager.getMaximumObscuringOpacityForTouch());
        }
        params.alpha = Math.max(0f, limit);
    }

    static void addCloseControl(LinearLayout target, Runnable close) {
        LinearLayout row = new LinearLayout(target.getContext());
        row.setGravity(Gravity.END | Gravity.CENTER_VERTICAL);
        TextView button = new TextView(target.getContext());
        button.setText("×");
        button.setTextColor(WHITE);
        button.setTextSize(20f);
        button.setGravity(Gravity.CENTER);
        button.setContentDescription("Fechar card NVU");
        button.setOnClickListener(v -> close.run());
        int size = Math.round(28 * target.getResources().getDisplayMetrics().density);
        row.addView(button, new LayoutParams(size, size));
        target.addView(row, new LayoutParams(LayoutParams.MATCH_PARENT, size));
    }

    static View dismissibleMessage(View message, Runnable close) {
        LinearLayout card = new LinearLayout(message.getContext());
        card.setOrientation(VERTICAL);
        GradientDrawable surface = new GradientDrawable();
        surface.setColor(Color.rgb(31, 36, 43));
        surface.setCornerRadius(12 * message.getResources().getDisplayMetrics().density);
        card.setBackground(surface);
        addCloseControl(card, close);
        card.addView(message, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        return card;
    }

    private static final class IconView extends View {
        static final int CHECK = 1, CLOCK = 2, ARROW = 3, LOCATION = 4;
        private final int kind, color;
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        IconView(Context context, int kind, int color) { super(context); this.kind = kind; this.color = color; }
        @Override protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            float w = getWidth(), h = getHeight();
            canvas.save();
            canvas.scale(w / 28f, h / 28f);
            paint.setColor(color);
            if (kind == LOCATION) {
                paint.setStyle(Paint.Style.STROKE);
                paint.setStrokeWidth(2.2f);
                paint.setStrokeJoin(Paint.Join.ROUND);
                Path pin = new Path();
                pin.moveTo(14, 26);
                pin.cubicTo(10, 21, 5, 16, 5, 11);
                pin.cubicTo(5, -1, 23, -1, 23, 11);
                pin.cubicTo(23, 16, 18, 21, 14, 26);
                pin.close();
                canvas.drawPath(pin, paint);
                canvas.drawCircle(14, 10, 3, paint);
            } else if (kind == ARROW) {
                paint.setStyle(Paint.Style.FILL);
                Path path = new Path();
                path.moveTo(2, 13); path.lineTo(26, 2); path.lineTo(15, 26);
                path.lineTo(12, 16); path.close();
                canvas.drawPath(path, paint);
            } else {
                paint.setStyle(Paint.Style.STROKE);
                paint.setStrokeWidth(2.5f);
                paint.setStrokeCap(Paint.Cap.ROUND);
                paint.setStrokeJoin(Paint.Join.ROUND);
                canvas.drawCircle(14, 14, 12, paint);
                Path path = new Path();
                if (kind == CHECK) {
                    path.moveTo(8, 14); path.lineTo(12, 18); path.lineTo(20, 10);
                } else {
                    path.moveTo(14, 7); path.lineTo(14, 14); path.lineTo(19, 16);
                }
                canvas.drawPath(path, paint);
            }
            canvas.restore();
        }
    }

    private static final class ProgressTrack extends View {
        private final float fraction;
        private final int color;
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final RectF rect = new RectF();
        ProgressTrack(Context context, float fraction, int color) {
            super(context); this.fraction = Math.max(0f, Math.min(1f, fraction)); this.color = color;
        }
        @Override protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            float radius = getHeight() / 2f;
            rect.set(0, 0, getWidth(), getHeight());
            paint.setColor(Color.rgb(65, 78, 90));
            canvas.drawRoundRect(rect, radius, radius, paint);
            if (fraction > 0f) {
                rect.right = getWidth() * fraction;
                paint.setColor(color);
                canvas.drawRoundRect(rect, radius, radius, paint);
            }
        }
    }
}
