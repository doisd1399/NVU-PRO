package com.nvu.operacional;

import android.content.Context;
import android.content.res.Configuration;
import android.view.MotionEvent;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Real Android measure/dispatch checks; no network or production writes. */
@RunWith(AndroidJUnit4.class)
public class NativeCompactMenuInstrumentationTest {
    private void verify(float fontScale,String company,int widthDp) {
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            Context base=InstrumentationRegistry.getInstrumentation().getTargetContext();
            Configuration config=new Configuration(base.getResources().getConfiguration());config.fontScale=fontScale;
            Context context=base.createConfigurationContext(config);float d=context.getResources().getDisplayMetrics().density;
            NativeCompactMenuView menu=new NativeCompactMenuView(context);
            assertEquals("No reserved close row",0,menu.getChildCount());
            NativeCompactMenuScrollView scroll=new NativeCompactMenuScrollView(context,()->Math.round(180*d));
            LinearLayout content=new LinearLayout(context);content.setOrientation(LinearLayout.VERTICAL);
            TextView title=new TextView(context);title.setText(company);title.setTextSize(14f);
            title.setPadding(Math.round(5*d),Math.round(3*d),Math.round(5*d),Math.round(3*d));
            content.addView(title,new LinearLayout.LayoutParams(-1,-2));
            TextView body=new TextView(context);body.setText("Sistema inteligente de automação pro\nHistórico da operação\nViagem em andamento\nAgro Grão → Águas Velhas");body.setTextSize(11.5f);
            content.addView(body,new LinearLayout.LayoutParams(-1,-2));scroll.addView(content);menu.addView(scroll);
            int width=Math.round(widthDp*d);menu.measure(View.MeasureSpec.makeMeasureSpec(width,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(0,View.MeasureSpec.UNSPECIFIED));
            menu.layout(0,0,width,menu.getMeasuredHeight());
            assertEquals("8dp top inset",Math.round(8*d),menu.getPaddingTop());
            assertEquals("Company comes first",title,content.getChildAt(0));
            assertEquals("Whole company name is laid out",company.length(),title.getLayout().getLineEnd(title.getLayout().getLineCount()-1));
            assertTrue("Scrollable body stays within maximum height",scroll.getMeasuredHeight()<=Math.round(180*d));
        });
    }
    @Test public void idleMenuWithoutCloseRow(){verify(1f,"DC Transportes",256);}
    @Test public void longCompanyAtLargeFontInNarrowScreen(){verify(2f,"Transportadora de Cargas e Logística com Nome Muito Extenso",220);}
    @Test public void outsideDismissPreservesTheSimulatorsTouch() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();NativeCompactMenuView menu=new NativeCompactMenuView(context);
            int[] calls={0};NativeCompactMenuView.bindOutsideDismiss(menu,()->true,()->calls[0]++);
            MotionEvent event=MotionEvent.obtain(0,0,MotionEvent.ACTION_OUTSIDE,0,0,0);
            try{assertFalse(menu.dispatchTouchEvent(event));assertEquals(1,calls[0]);}finally{event.recycle();}
            NativeCompactMenuView.bindOutsideDismiss(menu,()->false,()->calls[0]++);
            event=MotionEvent.obtain(0,1,MotionEvent.ACTION_OUTSIDE,0,0,0);
            try{menu.dispatchTouchEvent(event);assertEquals("Stale menu cannot dismiss another",1,calls[0]);}finally{event.recycle();}
        });
    }
}
