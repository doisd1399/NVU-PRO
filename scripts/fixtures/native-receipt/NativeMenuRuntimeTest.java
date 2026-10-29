package com.nvu.operacional;
import android.view.*; import android.widget.*; import java.util.*; import java.nio.file.*;

public final class NativeMenuRuntimeTest {
    static int checks;
    static void ck(String label, boolean ok) {
        if (!ok) throw new AssertionError(label);
        checks++; System.out.println("PASS " + label);
    }
    static ProMenuHarness host() {
        ProMenuHarness h = new ProMenuHarness(); h.setup();
        h.prefs.edit().putString("companyName", "DC Transportes").putString("simpleState", "IDLE").apply();
        return h;
    }
    static List<TextView> texts(View v) {
        List<TextView> result=new ArrayList<>();
        if(v instanceof TextView)result.add((TextView)v);
        if(v instanceof ViewGroup)for(View child:((ViewGroup)v).children)result.addAll(texts(child));
        return result;
    }
    static TextView text(View v,String value) {
        return texts(v).stream().filter(t->t.text.equals(value)).findFirst().orElseThrow();
    }
    static long visible(ProMenuHarness h) {
        return h.windowManager.windows.stream().filter(v->v.getVisibility()==View.VISIBLE).count();
    }
    static void begin(ProMenuHarness h) {
        h.open(); text(h.menuView,"Iniciar viagem").performClick();
        text(h.menuView,"Agro Grão").performClick();
    }
    static void confirmedRoute(ProMenuHarness h,long event) {
        h.prefs.edit().putString("simpleState", "TRIP_ACTIVE").putString("origin","Agro Grão")
            .putString("destination","Águas Velhas").putLong("tripStartedAt",event).apply();
    }
    public static void main(String[] args) throws Exception {
        ProMenuHarness h=host(); h.open();
        ck("Menu content starts in the root inset without X",h.menuView instanceof NativeCompactMenuView
            &&h.menuView.children.size()==1&&h.menuView.children.get(0) instanceof ScrollView
            &&texts(h.menuView).stream().noneMatch(t->t.text.equals("×")||t.text.equals("X")));
        ck("Company is the first content item",texts(h.menuView).get(0).text.equals("DC Transportes"));
        ck("Root preserves 8dp padding and existing surface",h.menuView.paddingTop==h.dp(8)
            &&((android.graphics.drawable.GradientDrawable)h.menuView.background).color==android.graphics.Color.argb(214,28,31,36));
        ck("Idle controls preserved",text(h.menuView,"Iniciar viagem")!=null&&text(h.menuView,"Operação atual")!=null
            &&text(h.menuView,"Histórico da operação")!=null);
        ck("Menu opens with outside-pass-through flags",(h.menuParams.flags&WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL)!=0
            &&(h.menuParams.flags&WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH)!=0);
        ck("Inside menu touch does not dismiss",!h.menuView.dispatchTouchEvent(new MotionEvent(MotionEvent.ACTION_DOWN))&&h.menuView!=null);
        View old=h.menuView; h.outside(old);
        ck("Outside touch closes menu and restores same coordinates",h.menuView==null&&h.bubbleView.visibility==View.VISIBLE
            &&h.bubbleParams.x==79&&h.bubbleParams.y==45);
        h.open(); View replacement=h.menuView; h.outside(old);
        ck("Old menu outside event cannot close replacement",h.menuView==replacement);

        h=host(); begin(h);
        ck("Origin selection retains destination flow",h.prefs.getString("simpleState","").equals(ProMenuHarness.STATE_ROUTE_DESTINATION)
            &&h.menuView!=null&&h.statusChipView==null);
        View selector=h.menuView; text(selector,"Agro Grão").performClick(); h.flush();
        ck("Invalid same-city selection keeps selector and state",h.menuView==selector
            &&h.prefs.getString("simpleState","").equals(ProMenuHarness.STATE_ROUTE_DESTINATION)
            &&!h.prefs.contains("tripStartedAt"));
        h.dismiss(); h.bubbleView.visibilityHistory.clear();
        text(h.menuView,"Águas Velhas").performClick(); h.flush();
        ck("Valid destination collapses menu and selector",h.menuView==null&&h.menuParams==null);
        ck("Ready message is the only visible NVU window",visible(h)==1
            &&text(h.statusChipView,NativeRouteReadySnapshot.MESSAGE)!=null);
        ck("Bubble stays hidden and non-touchable during ready",h.bubbleView.visibility==View.INVISIBLE
            &&(h.bubbleParams.flags&WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE)!=0);
        ck("Transition has no intermediate visible bubble",!h.bubbleView.visibilityHistory.contains(View.VISIBLE));
        ck("Trip, route and voice remain accepted",h.prefs.getString("simpleState","").equals("TRIP_ACTIVE")
            &&h.prefs.getString("origin","").equals("Agro Grão")&&h.prefs.getString("destination","").equals("Águas Velhas")
            &&h.prefs.getString("captureStage","").equals("TRIP_ACTIVE")&&h.prefs.getLong("tripStartedAt",0)>0&&h.voices==1);
        h.open(); ck("Menu cannot reopen behind the current ready message",h.menuView==null);
        h.statusChipHideRunnable.run();
        ck("Ready timeout restores input and original position",h.statusChipView==null&&h.bubbleView.visibility==View.VISIBLE
            &&h.bubbleParams.flags==8&&h.bubbleParams.x==79&&h.bubbleParams.y==45);
        ck("Timeout never reopens menu",h.menuView==null);
        h.open();
        ck("User reopens preserved active-trip controls",text(h.menuView,"Cancelar")!=null&&text(h.menuView,"Finalizar")!=null
            &&text(h.menuView,"Viagem em andamento\nAgro Grão → Águas Velhas")!=null);

        h=host();begin(h);h.windowManager.failNext=true;text(h.menuView,"Águas Velhas").performClick();h.flush();
        ck("Message attachment failure restores an accessible active menu",h.menuView!=null&&h.statusChipView==null&&h.errors==1
            &&text(h.menuView,"Finalizar")!=null);
        ck("Attachment failure does not strand suppression",h.cardVisibility.isSuppressed());
        h.outside(h.menuView);ck("Failure recovery can close without X",h.bubbleView.visibility==View.VISIBLE);

        h=host();begin(h);selector=h.menuView;h.prefs.edit().putString("origin","").apply();
        text(selector,"Águas Velhas").performClick();h.flush();
        ck("Missing origin cannot start a false ready flow",h.menuView==selector&&!h.prefs.contains("tripStartedAt")
            &&h.statusChipRouteReady==null);
        h=host();h.open();selector=h.menuView;confirmedRoute(h,1);h.ready();
        h.prefs.edit().putString("driverId","different-driver").apply();h.flush();
        ck("Late callback cannot close a new account menu",h.menuView==selector&&h.statusChipView==null);
        h=host();h.open();selector=h.menuView;confirmedRoute(h,1);h.ready();
        h.prefs.edit().putString("jobId","different-job").apply();h.flush();
        ck("Late callback cannot publish into a different operation",h.menuView==selector&&h.statusChipView==null);
        h=host();confirmedRoute(h,1);h.ready();h.prefs.edit().putString("simpleState","IDLE").apply();h.flush();
        ck("Canceled route rejects queued ready publication",h.statusChipView==null);

        h=host();confirmedRoute(h,1);h.ready();h.flush();Runnable timerA=h.statusChipHideRunnable;
        h.prefs.edit().putString("destination","Registro").putLong("tripStartedAt",2).apply();h.ready();h.flush();
        View readyB=h.statusChipView;timerA.run();
        ck("Old ready timer cannot remove a consecutive message",h.statusChipView==readyB&&h.bubbleView.visibility==View.INVISIBLE);
        h.message("Aviso seguinte");h.flush();View message=h.statusChipView;h.statusChipHideRunnable.run();
        ck("Message replacement restores only after the last timeout",message!=readyB&&h.statusChipView==null&&h.bubbleView.visibility==View.VISIBLE);
        h=host();confirmedRoute(h,1);h.ready();h.flush();timerA=h.statusChipHideRunnable;
        h.destroying=true;h.cardVisibility.close();h.dismiss();timerA.run();h.ready();h.flush();
        ck("Shutdown rejects pending publications and restoration",h.statusChipView==null&&h.bubbleView.visibility==View.INVISIBLE);

        h=host();h.open();ProMenuHarness.setRoute(h,"Agro Grão","Registro");h.flush();
        ck("Native bridge uses the exclusive ready transition",h.menuView==null&&visible(h)==1&&h.voices==1);
        String route=h.prefs.getString("destination","");long routeTime=h.prefs.getLong("routeUpdatedAt",0);
        ProMenuHarness.setRoute(h,"","Registro");h.flush();
        ck("Invalid bridge input preserves accepted route",route.equals(h.prefs.getString("destination",""))
            &&routeTime==h.prefs.getLong("routeUpdatedAt",0));

        h=host();h.prefs.edit().putString("companyName","Transportadora de Cargas e Logística com Nome Muito Extenso").apply();
        h.resources.metrics.scaledDensity=h.resources.metrics.density*2;h.open();
        ck("Long company name remains complete and multiline",text(h.menuView,h.prefs.getString("companyName","")).maxLines==Integer.MAX_VALUE);
        ck("Default compact control height is preserved",NativeCompactMenuView.controlExtent(host(),28)==42);
        ck("Large-font actions grow without clipping two lines",text(h.menuView,"Iniciar viagem").layoutParams.height==h.dp(56)
            &&text(h.menuView,"Operação atual").layoutParams.height==h.dp(56));
        ck("Large-font information icons have room",text(h.menuView,"☷").layoutParams.height==h.dp(60));
        NativeCompactMenuScrollView scroll=(NativeCompactMenuScrollView)h.menuView.children.get(0);
        scroll.measure(View.MeasureSpec.makeMeasureSpec(h.dp(256),View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(0,View.MeasureSpec.UNSPECIFIED));
        int landscapeLimit=h.resources.metrics.heightPixels-h.dp(32);
        ck("Large-font body is bounded by screen height",View.MeasureSpec.getSize(scroll.measuredHeightSpec)==landscapeLimit
            &&View.MeasureSpec.getMode(scroll.measuredHeightSpec)==View.MeasureSpec.AT_MOST);
        h.resources.metrics.heightPixels=300;scroll.measure(0,View.MeasureSpec.makeMeasureSpec(0,View.MeasureSpec.UNSPECIFIED));
        ck("Rotation remeasures available scroll space",View.MeasureSpec.getSize(scroll.measuredHeightSpec)==300-h.dp(32));
        h=host();begin(h);scroll=(NativeCompactMenuScrollView)h.menuView.children.get(0);h.resources.metrics.heightPixels=240;
        scroll.measure(0,View.MeasureSpec.makeMeasureSpec(500,View.MeasureSpec.EXACTLY));
        ck("Route selector keeps space for fixed Back after resize",View.MeasureSpec.getSize(scroll.measuredHeightSpec)==240-h.dp(32)-NativeCompactMenuView.controlExtent(h,31)-h.dp(5)
            &&text(h.menuView,"Voltar")!=null);
        h.resources.metrics.scaledDensity=h.resources.metrics.density*2;
        scroll.measure(0,View.MeasureSpec.makeMeasureSpec(500,View.MeasureSpec.EXACTLY));
        ck("Large-font Back gets its real space in the selector",View.MeasureSpec.getSize(scroll.measuredHeightSpec)==240-h.dp(32)-NativeCompactMenuView.controlExtent(h,31)-h.dp(5));
        ck("Max shares no-X surface without synthetic children",new NativeCompactMenuView(h).children.isEmpty());

        if(args.length>0)exportPreviews(Paths.get(args[0]));
        System.out.println("Native compact menu runtime: PASS "+checks+"/"+checks);
    }
    static String quote(String s) {return "\""+s.replace("\\","\\\\").replace("\"","\\\"").replace("\n","\\n")+"\"";}
    static String tree(View view) {
        if(view==null)return "null";
        StringBuilder b=new StringBuilder("{\"type\":").append(quote(view.getClass().getSimpleName()));
        b.append(",\"padding\":[").append(view.paddingLeft).append(',').append(view.paddingTop).append(',').append(view.paddingRight).append(',').append(view.paddingBottom).append(']');
        b.append(",\"visibility\":").append(view.visibility);
        if(view.background instanceof android.graphics.drawable.GradientDrawable){android.graphics.drawable.GradientDrawable d=(android.graphics.drawable.GradientDrawable)view.background;b.append(",\"color\":").append(d.color).append(",\"radius\":").append(d.radius);}
        ViewGroup.LayoutParams p=view.layoutParams;
        if(p!=null){b.append(",\"width\":").append(p.width).append(",\"height\":").append(p.height);
            if(p instanceof LinearLayout.LayoutParams){LinearLayout.LayoutParams l=(LinearLayout.LayoutParams)p;b.append(",\"weight\":").append(l.weight).append(",\"margin\":[").append(l.leftMargin).append(',').append(l.topMargin).append(',').append(l.rightMargin).append(',').append(l.bottomMargin).append(']');}}
        if(view instanceof TextView){TextView t=(TextView)view;b.append(",\"text\":").append(quote(t.text)).append(",\"sizeSp\":").append(t.textSize).append(",\"bold\":").append(t.bold).append(",\"textColor\":").append(t.color).append(",\"gravity\":").append(t.gravity);}
        if(view instanceof LinearLayout)b.append(",\"orientation\":").append(((LinearLayout)view).orientation);
        if(view instanceof ViewGroup){b.append(",\"children\":[");boolean first=true;for(View child:((ViewGroup)view).children){if(!first)b.append(',');first=false;b.append(tree(child));}b.append(']');}
        return b.append('}').toString();
    }
    static String frame(ProMenuHarness h){return "{\"menu\":"+tree(h.menuView)+",\"message\":"+tree(h.statusChipView)+",\"bubbleVisible\":"+(h.bubbleView.visibility==View.VISIBLE)+",\"bubbleTouchable\":"+((h.bubbleParams.flags&WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE)==0)+"}";}
    static void exportPreviews(Path path) throws Exception {
        ProMenuHarness h=host();h.open();String idle=frame(h);
        confirmedRoute(h,1);h.outside(h.menuView);h.open();String active=frame(h);
        h.ready();h.flush();String ready=frame(h);h.statusChipHideRunnable.run();String after=frame(h);
        h=host();h.resources.metrics.scaledDensity=h.resources.metrics.density*2;
        h.prefs.edit().putString("companyName","Transportadora de Cargas e Logística com Nome Muito Extenso").apply();h.open();
        Files.createDirectories(path.getParent());
        Files.writeString(path,"{\"captureType\":\"source-view-tree-preview-not-device\",\"density\":"+h.resources.metrics.density
            +",\"idle\":"+idle+",\"active\":"+active+",\"ready\":"+ready+",\"after\":"+after+",\"largeFont\":"+frame(h)+"}\n");
    }
}
