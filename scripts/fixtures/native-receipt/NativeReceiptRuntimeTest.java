package com.nvu.operacional;
import android.view.*; import android.widget.*; import java.util.*; import org.json.JSONObject;
public final class NativeReceiptRuntimeTest {
 static int checks;
 static void ck(String label,boolean ok){if(!ok)throw new AssertionError(label);checks++;System.out.println("PASS "+label);}
 static NativeTripReceipt receipt(String id){return new NativeTripReceipt(NativeTripReceipt.State.CONFIRMED,
  id,id+"-trip","driver-a","company-a","job-a","","Agro Grão","Registro","R$ 34.377,00",3,12);}
 static List<TextView> texts(View v){List<TextView> found=new ArrayList<>();if(v instanceof TextView)found.add((TextView)v);
  if(v instanceof android.view.ViewGroup)for(View c:((android.view.ViewGroup)v).children)found.addAll(texts(c));return found;}
 static TextView text(View v,String s){return texts(v).stream().filter(t->t.text.equals(s)).findFirst().orElseThrow();}
 public static void main(String[] args){
  NativeTripReceipt r=receipt("old-session");
  ck("3/12 is 25 percent",r.counter().equals("3/12")&&r.fraction()==0.25f);
  ck("explicit confirmed state controls title",r.heading.equals("Viagem registrada"));
  NativeTripReceipt pending=new NativeTripReceipt(NativeTripReceipt.State.PENDING,"p","","driver-a","company-a","job-a",
    "Viagem registrada","","","",2,0);
  ck("pending never claims server registration",!pending.heading.equals("Viagem registrada"));
  ck("unknown total has no fabricated fraction",pending.counter().equals("—")&&pending.fraction()==0);
  ck("unknown route is explicit",pending.route().contains("indisponível"));
  ck("over progress is bounded",new NativeTripReceipt(NativeTripReceipt.State.CONFIRMED,"","","","","","","","","",99,12).fraction()==1f);
  ck("foreign driver rejected",!r.belongsTo("other"));
  List<Boolean> transitions=new ArrayList<>();
  NativeOverlayCardVisibility visibility=new NativeOverlayCardVisibility(transitions::add);
  Object a=new Object(),b=new Object();
  visibility.acquire(a);visibility.acquire(b);visibility.release(a);
  ck("A timeout cannot show bubble while B exists",visibility.isSuppressed()&&transitions.equals(Arrays.asList(true)));
  visibility.release(a);visibility.release(b);
  ck("last release restores exactly once",transitions.equals(Arrays.asList(true,false)));
  visibility.acquire(a);visibility.close();visibility.release(a);
  ck("shutdown rejects late publication",visibility.isSuppressed()&&!visibility.acquire(b));
  ck("approved wider receipt fits both columns",NativeReceiptCardLayoutPolicy.width(1536,0,0,1.5f)==660);
  ck("reference card centered",NativeReceiptCardLayoutPolicy.x(1536,0,0,660)==438);
  ck("asymmetric cutout does not shift visual center",NativeReceiptCardLayoutPolicy.x(2048,88,16,880)==584);
  ck("approved card is closer to top",NativeReceiptCardLayoutPolicy.y(691,0,0,118)==53);
  ck("narrow screen stays in safe region",NativeReceiptCardLayoutPolicy.width(300,20,40,1.5f)==240);
  ck("tall card respects safe top",NativeReceiptCardLayoutPolicy.y(200,30,20,250)==30);

  android.content.Context context=new android.content.Context();
  NativeTripReceiptCardView card=new NativeTripReceiptCardView(context,r);
  ck("approved labels are native TextViews",text(card,"NVU PRO")!=null&&text(card,r.heading)!=null&&text(card,r.route())!=null);
  ck("all fields stay on one line",texts(card).stream().allMatch(t->t.maxLines==1&&t.singleLine));
  ck("no extra message row",texts(card).stream().noneMatch(t->t.text.toLowerCase().contains("enviando mensagem"))
    &&card.children.size()==3);
  ck("amount is separate green header field",text(card,"R$ 34.377,00").color==android.graphics.Color.rgb(40,189,145));
  ck("footer preserves counter",text(card,"Operação atual")!=null&&text(card,"3/12")!=null);
  LinearLayout footer=(LinearLayout)card.children.get(2);
  LinearLayout progress=(LinearLayout)footer.children.get(2);
  View track=progress.children.get(2);track.width=196;track.height=20;
  android.graphics.Canvas canvas=new android.graphics.Canvas();track.draw(canvas);
  ck("actual renderer paints 25 percent",canvas.rounds.size()==2&&canvas.rounds.get(1)[2]==49f);
  context.resources.metrics.scaledDensity=3;
  NativeTripReceiptCardView enlarged=new NativeTripReceiptCardView(context,r);
  enlarged.measure(View.MeasureSpec.makeMeasureSpec(660,View.MeasureSpec.EXACTLY),0);
  ck("large font stacks footer without dropping labels",((LinearLayout)enlarged.children.get(2)).orientation==LinearLayout.VERTICAL
   &&text(enlarged,r.earnings)!=null&&text(enlarged,r.route())!=null);
  ck("large font keeps heading and route single line",text(enlarged,r.heading).maxLines==1&&text(enlarged,r.route()).maxLines==1);
  context.resources.metrics.scaledDensity=1.5f;
  NativeTripReceipt inFlight=new NativeTripReceipt(NativeTripReceipt.State.PENDING,"pending","","driver-a","company-a","job-a",
    "Enviando viagem…","Nova Macaé","Itapetuna","R$ 2.341,00",6,12);
  NativeTripReceiptCardView sending=new NativeTripReceiptCardView(context,inFlight);
  sending.measure(View.MeasureSpec.makeMeasureSpec(660,View.MeasureSpec.EXACTLY),0);
  ck("sending uses same compact two-row card",sending.children.size()==3
    &&((LinearLayout)sending.children.get(0)).orientation==LinearLayout.HORIZONTAL
    &&((LinearLayout)sending.children.get(2)).orientation==LinearLayout.HORIZONTAL);
  ck("sending keeps route and title single line",text(sending,"Enviando viagem…").singleLine
    &&text(sending,"Nova Macaé → Itapetuna").singleLine);
  ck("pending receipt cannot claim registration",texts(sending).stream().noneMatch(t->t.text.equals("Viagem registrada")));
  sending.measure(View.MeasureSpec.makeMeasureSpec(300,View.MeasureSpec.EXACTLY),0);
  ck("narrow card reflows complete fields",((LinearLayout)sending.children.get(0)).orientation==LinearLayout.VERTICAL
    &&((LinearLayout)sending.children.get(2)).orientation==LinearLayout.VERTICAL);
  sending.measure(View.MeasureSpec.makeMeasureSpec(660,View.MeasureSpec.EXACTLY),0);
  ck("wider card restores original two rows",((LinearLayout)sending.children.get(0)).orientation==LinearLayout.HORIZONTAL
    &&((LinearLayout)sending.children.get(2)).orientation==LinearLayout.HORIZONTAL);
  for(int screen:new int[]{480,960,1536,2048,2400})for(int left:new int[]{0,48})for(int right:new int[]{0,80}){
   int width=NativeReceiptCardLayoutPolicy.width(screen,left,right,1.5f);
   int x=NativeReceiptCardLayoutPolicy.x(screen,left,right,width);
   int centered=Math.max(left,Math.min(screen-right-width,(screen-width)/2));
   if(x<left||x+width>screen-right||x!=centered)
    throw new AssertionError("unsafe or off-center receipt");
  }
  ck("receipt centered in 20 cutout/navigation combinations",true);

  JSONObject payload=new JSONObject().put("sessionId","old-session").put("driverId","driver-a")
   .put("companyId","company-a").put("jobId","job-a").put("origin","Agro Grão").put("destination","Registro").put("finalValue","€ 34.377,25");
  JSONObject snapshot=new JSONObject().put("sessionId","old-session").put("driverId","driver-a")
   .put("companyId","company-a").put("jobId","job-a").put("jobTotalDeliveries",12);
  NativeTripReceipt frozen=NativeTripReceiptPreferences.fromAcknowledgement(payload,snapshot,"ack-trip",3);
  payload.put("origin","Next origin");snapshot.put("jobTotalDeliveries",99);
  ck("receipt frozen before next-session mutation",frozen.origin.equals("Agro Grão")&&frozen.total==12);
  ck("currency and cents preserved verbatim",frozen.earnings.equals("€ 34.377,25"));
  JSONObject foreignSnapshot=new JSONObject().put("sessionId","new-session").put("jobTotalDeliveries",200);
  ck("foreign snapshot total rejected",NativeTripReceiptPreferences.fromAcknowledgement(payload,foreignSnapshot,"ack",3).total==0);
  FakePrefs prefs=new FakePrefs();prefs.edit().putString("driverId","driver-a").apply();
  ck("ACK UI recovery snapshot persisted",NativeTripReceiptPreferences.save(prefs,frozen));
  ck("recovery matches exact session",NativeTripReceiptPreferences.read(prefs,"new-session")==null&&NativeTripReceiptPreferences.read(prefs,"old-session")!=null);
  prefs.edit().putString("driverId","driver-b").apply();
  ck("account switch cannot read old receipt",NativeTripReceiptPreferences.read(prefs,"old-session")==null);

  ProReceiptHarness pro=new ProReceiptHarness();pro.setup();pro.show(r);
  ck("Pro actual show method hides bubble",pro.bubbleView.getVisibility()==View.INVISIBLE
    &&(pro.bubbleParams.flags&WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE)!=0);
  ck("Pro card does not alter coordinates",pro.bubbleParams.x==79&&pro.bubbleParams.y==45);
  ck("Pro actual card uses approved component",pro.statusChipView instanceof NativeTripReceiptCardView);
  View approved=pro.statusChipView;
  pro.show(r);
  ck("Pro duplicate confirmation keeps same view",pro.statusChipView==approved);
  pro.show(new NativeTripReceipt(NativeTripReceipt.State.PENDING,"old-session","","driver-a","company-a","job-a",
    "Enviando viagem…","Agro Grão","Registro","R$ 34.377,00",3,12));
  ck("Pro stale pending state cannot downgrade ACK",pro.statusChipView==approved);
  Runnable oldTimeout=pro.statusChipHideRunnable;
  pro.show(receipt("next-ack"));oldTimeout.run();
  ck("Pro stale timeout cannot dismiss replacement",((NativeTripReceiptCardView)pro.statusChipView).receipt.sessionId.equals("next-ack")
   &&pro.bubbleView.getVisibility()==View.INVISIBLE);
  pro.dismiss();
  ck("Pro closes and restores original touch flags",pro.bubbleView.getVisibility()==View.VISIBLE&&pro.bubbleParams.flags==8);
  pro.windowManager.failNext=true;pro.show(receipt("rejected-window"));
  ck("Pro addView failure rolls visibility back",pro.statusChipView==null&&pro.bubbleView.getVisibility()==View.VISIBLE&&pro.errors==1);
  pro.show(new NativeTripReceipt(NativeTripReceipt.State.CONFIRMED,"foreign","foreign","driver-a","company-b","job-b",
    "","Old origin","Old destination","R$ 10,00",1,5));
  ck("Pro async operation switch cannot show old receipt",pro.statusChipView==null);
  pro.orientation=false;pro.show(r);
  ck("Pro portrait does not publish a card",pro.statusChipView==null);
  pro.orientation=true;pro.show(r);pro.destroying=true;pro.cardVisibility.close();pro.dismiss();
  oldTimeout.run();pro.show(receipt("after-stop"));
  ck("Pro late callbacks cannot revive overlays",pro.statusChipView==null&&pro.bubbleView.getVisibility()==View.INVISIBLE);

  MaxReceiptHarness max=new MaxReceiptHarness();max.setup();max.show(r);
  ck("Max actual show method hides bubble",max.bubbleView.getVisibility()==View.INVISIBLE);
  ck("Max actual renderer and immutable route",max.tripRegisteredCardView instanceof NativeTripReceiptCardView
    &&((NativeTripReceiptCardView)max.tripRegisteredCardView).receipt.origin.equals("Agro Grão"));
  ck("Max never docks bubble for receipt",max.bubbleParams.x==79&&max.bubbleParams.y==45);
  oldTimeout=max.tripRegisteredCardHideRunnable;
  max.show(receipt("late-ack"));oldTimeout.run();
  ck("Max old timeout cannot restore bubble during new card",max.tripRegisteredCardView!=null&&max.bubbleView.getVisibility()==View.INVISIBLE);
  View current=max.tripRegisteredCardView;max.show(receipt("late-ack"));
  ck("duplicate ACK does not rebuild card",max.tripRegisteredCardView==current);
  max.show(new NativeTripReceipt(NativeTripReceipt.State.CONFIRMED,"bad","bad","other","company-a","job-a","","","","",3,12));
  ck("Max ignores foreign-owner card",max.tripRegisteredCardView==current);
  max.show(new NativeTripReceipt(NativeTripReceipt.State.CONFIRMED,"bad","bad","driver-a","company-b","job-b","","","","",3,12));
  ck("Max ignores a different active operation",max.tripRegisteredCardView==current);
  max.dismiss();
  ck("Max restores original position and input",max.bubbleView.getVisibility()==View.VISIBLE&&max.bubbleParams.flags==8&&max.bubbleParams.x==79);
  max.windowManager.failNext=true;max.show(receipt("reject"));
  ck("Max rejected window does not strand button",max.tripRegisteredCardView==null&&max.bubbleView.getVisibility()==View.VISIBLE);
  max.show(r);oldTimeout=max.tripRegisteredCardHideRunnable;max.destroying=true;max.cardVisibility.close();max.dismiss();oldTimeout.run();
  ck("Max shutdown cancels surface and cannot restore",max.tripRegisteredCardView==null&&max.tripRegisteredCardHideRunnable==null
    &&max.bubbleView.getVisibility()==View.INVISIBLE);
  android.hardware.input.InputManager.maximum=0.65f;
  WindowManager.LayoutParams params=new WindowManager.LayoutParams(10,10,1,16,0);
  NativeTripReceiptCardView.applyPassThroughOpacity(context,params);
  ck("system obscuring limit is respected",params.alpha==0.65f);
  ProReceiptHarness permissionHost=new ProReceiptHarness();permissionHost.setup();permissionHost.show(r);
  ProModeController.permission=false;permissionHost.dismiss();
  ck("permission revocation prevents button restoration",permissionHost.bubbleView.getVisibility()==View.INVISIBLE);
  ProModeController.permission=true;
  NativeBubbleVisibility adapter=new NativeBubbleVisibility();
  View restored=new View(context);
  WindowManager.LayoutParams restoredParams=new WindowManager.LayoutParams(68,32,1,8,0);
  restoredParams.x=220;restoredParams.y=77;
  adapter.apply(restored,restoredParams,null,false);
  ck("recreated bubble starts invisible and non-touchable",restored.visibility==View.INVISIBLE&&restoredParams.flags==24);
  adapter.apply(restored,restoredParams,null,true);
  ck("recreated bubble restores flags without coordinate drift",restored.visibility==View.VISIBLE&&restoredParams.flags==8
   &&restoredParams.x==220&&restoredParams.y==77);
  System.out.println("Native receipt runtime: PASS "+checks+"/"+checks);
 }
}
