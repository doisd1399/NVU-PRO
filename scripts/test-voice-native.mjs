import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root = path.resolve(import.meta.dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nvu-voice-jvm-'));
// Controlled Android/Capacitor ports. The actual production playback classes
// below are compiled and executed; this is not an Android/device validation.
const files = {
 'android/os/SystemClock.java': `package android.os; public class SystemClock { public static long now=100000; public static long elapsedRealtime(){return now;} }`,
 'android/os/Looper.java': `package android.os; public class Looper { public static Looper getMainLooper(){return new Looper();} }`,
 'android/os/Handler.java': `package android.os; import java.util.*; public class Handler {
 record T(long at,Runnable fn){} static ArrayList<T> q=new ArrayList<>(); public Handler(Looper l){} public boolean post(Runnable r){q.add(new T(SystemClock.now,r));return true;}
 public boolean postDelayed(Runnable r,long ms){q.add(new T(SystemClock.now+ms,r));return true;} public void removeCallbacks(Runnable r){q.removeIf(t->t.fn==r);}
 public static void flush(){advance(0);} public static void advance(long ms){long end=SystemClock.now+ms;int n=0;while(true){T t=q.stream().filter(x->x.at<=end).min(Comparator.comparingLong(T::at)).orElse(null);if(t==null)break;if(++n>10000)throw new AssertionError("timer loop");q.remove(t);SystemClock.now=t.at;t.fn.run();}SystemClock.now=end;} }`,
 'android/content/SharedPreferences.java': `package android.content; import java.util.*; public class SharedPreferences { private final Map<String,Object> v=new HashMap<>();
 public boolean getBoolean(String k,boolean d){return v.get(k) instanceof Boolean b?b:d;} public String getString(String k,String d){return v.get(k) instanceof String s?s:d;}
 public long getLong(String k,long d){return v.get(k) instanceof Number n?n.longValue():d;} public float getFloat(String k,float d){return v.get(k) instanceof Number n?n.floatValue():d;}
 public Editor edit(){return new Editor();} public class Editor { public Editor putBoolean(String k,boolean x){v.put(k,x);return this;} public Editor putString(String k,String x){v.put(k,x);return this;}
 public Editor putLong(String k,long x){v.put(k,x);return this;} public Editor putFloat(String k,float x){v.put(k,x);return this;} public Editor remove(String k){v.remove(k);return this;} public void apply(){} } }`,
 'android/content/Context.java': `package android.content; import java.util.*; import android.content.res.AssetManager; public class Context { public static final int MODE_PRIVATE=0;
 private final Map<String,SharedPreferences> p=new HashMap<>(); public Context getApplicationContext(){return this;} public SharedPreferences getSharedPreferences(String k,int mode){return p.computeIfAbsent(k,x->new SharedPreferences());} public AssetManager getAssets(){return new AssetManager();} }`,
 'android/content/res/AssetFileDescriptor.java': `package android.content.res; import java.io.*; public class AssetFileDescriptor implements AutoCloseable { public static String last; public AssetFileDescriptor(String p){last=p;} public FileDescriptor getFileDescriptor(){return new FileDescriptor();}public long getStartOffset(){return 0;} public long getLength(){return 1;} public void close(){} }`,
 'android/content/res/AssetManager.java': `package android.content.res; import java.io.*; public class AssetManager { public AssetFileDescriptor openFd(String p)throws IOException{if(!new File(System.getProperty("nvu.root"),p).isFile())throw new FileNotFoundException(p);return new AssetFileDescriptor(p);} }`,
 'android/media/AudioAttributes.java': `package android.media; public class AudioAttributes { public static final int USAGE_MEDIA=1,USAGE_ASSISTANCE_NAVIGATION_GUIDANCE=12,CONTENT_TYPE_SPEECH=1;public static class Builder { public Builder setUsage(int x){return this;} public Builder setContentType(int x){return this;}public AudioAttributes build(){return new AudioAttributes();} } }`,
 'android/media/MediaPlayer.java': `package android.media; import android.content.Context;import android.os.*;import java.io.*;import java.util.*; public class MediaPlayer {
 public interface OnPreparedListener{void onPrepared(MediaPlayer p);}public interface OnCompletionListener{void onCompletion(MediaPlayer p);}public interface OnErrorListener{boolean onError(MediaPlayer p,int a,int b);}
 public static final List<MediaPlayer> all=new ArrayList<>();public static int playing=0,maxPlaying=0;public boolean started=false,released=false;public float volume=1;public String source="";
 OnPreparedListener prep;OnCompletionListener done;OnErrorListener error;public MediaPlayer(){all.add(this);} public static MediaPlayer create(Context c,int id,AudioAttributes a,int n){MediaPlayer p=new MediaPlayer();p.source="raw:"+id;return p;}
 public void setAudioAttributes(AudioAttributes a){}public void setDataSource(FileDescriptor f,long o,long l){source=android.content.res.AssetFileDescriptor.last;}public void setVolume(float l,float r){volume=l;}public void setLooping(boolean b){}
 public void setOnPreparedListener(OnPreparedListener x){prep=x;}public void setOnCompletionListener(OnCompletionListener x){done=x;}public void setOnErrorListener(OnErrorListener x){error=x;}
 public void prepareAsync(){new Handler(Looper.getMainLooper()).post(()->{if(!released&&prep!=null)prep.onPrepared(this);});}public void start(){if(released)throw new IllegalStateException();if(!started){started=true;playing++;maxPlaying=Math.max(maxPlaying,playing);if(playing>1)throw new AssertionError("overlapping voices");}}
 public void seekTo(int p){} public void pause(){if(started){started=false;playing--;}}public void stop(){pause();}public void reset(){pause();}public boolean isPlaying(){return started;}public void release(){pause();released=true;}public void complete(){pause();if(done!=null)done.onCompletion(this);} public static MediaPlayer current(){return all.stream().filter(p->p.started).findFirst().orElse(null);} }`,
 'com/getcapacitor/JSObject.java': `package com.getcapacitor;import java.util.*; public class JSObject extends HashMap<String,Object>{ public JSObject put(String k,Object v){super.put(k,v);return this;}public double optDouble(String k,double d){return get(k) instanceof Number n?n.doubleValue():d;}public int optInt(String k,int d){return get(k) instanceof Number n?n.intValue():d;}public long optLong(String k,long d){return get(k) instanceof Number n?n.longValue():d;} }`,
 'com/getcapacitor/PluginCall.java': `package com.getcapacitor; public class PluginCall {public JSObject data=new JSObject(),result;public String rejected;public JSObject getData(){return data;}public Boolean getBoolean(String k,Boolean d){return data.get(k) instanceof Boolean b?b:d;}public String getString(String k,String d){return data.get(k) instanceof String s?s:d;}public String getString(String k){return getString(k,null);}public void resolve(JSObject r){result=r;}public void resolve(){result=new JSObject();}public void reject(String s){rejected=s;} }`,
 'com/getcapacitor/Plugin.java': `package com.getcapacitor;import android.content.Context;public class Plugin {public static Context context;public Context getContext(){return context;}public void load(){}public void notifyListeners(String e,JSObject d){}protected void handleOnPause(){}protected void handleOnDestroy(){} }`,
 'com/getcapacitor/PluginMethod.java': `package com.getcapacitor;import java.lang.annotation.*;@Retention(RetentionPolicy.RUNTIME)@Target(ElementType.METHOD)public @interface PluginMethod{}`,
 'com/getcapacitor/annotation/CapacitorPlugin.java': `package com.getcapacitor.annotation;import java.lang.annotation.*;@Retention(RetentionPolicy.RUNTIME)@Target(ElementType.TYPE)public @interface CapacitorPlugin{String name();}`,
 'com/nvu/operacional/R.java': `package com.nvu.operacional;public class R {public static class raw {public static int nvu_ready_voice_pt_br=1,nvu_trip_completed_voice_pt_br=2,nvu_pause_alert_voice_pt_br=3,nvu_gto_automated_start_voice_pt_br=4;}}`,
 'com/nvu/operacional/VoiceTest.java': `package com.nvu.operacional;
 import android.content.*;import android.os.*;import android.media.*;import com.getcapacitor.*;import java.util.function.LongSupplier;
 public class VoiceTest {
 static int checks=0;static void ck(boolean x,String message){if(!x)throw new AssertionError(message);checks++;System.out.println("PASS "+message);}
 static class C implements NvuVoicePlayback.Callback{int starts,ends;boolean played,failed;public void started(){starts++;}public void finished(boolean p,boolean f){ends++;played=p;failed=f;}}
 public static void main(String[] args){Context c=new Context();Plugin.context=c;LongSupplier wall=()->1700000000000L+SystemClock.now;
 NvuAudioManager legacy=new NvuAudioManager(c,x->{});legacy.playReadyVoice("legacy-before-upgrade");ck(MediaPlayer.playing==1,"legacy phrase is playing before migration");
 NvuVoicePlayback q=new NvuVoicePlayback(c,wall);q.configure(true,"male",.65,"driver-a",null);Handler.flush();
 C first=new C();q.enqueue("event_trip_saved","one","web",3,wall.getAsLong()+20000,first);Handler.flush();ck(first.starts==0&&MediaPlayer.playing==1,"new channel waits for legacy phrase without interrupting it");
 MediaPlayer.current().complete();Handler.advance(150);ck(first.starts==1&&MediaPlayer.playing==1,"new channel starts after the legacy channel becomes free");
 MediaPlayer current=MediaPlayer.current();ck(current.source.endsWith("male/event_trip_saved.mp3"),"male playback uses the packaged approved asset");ck(Math.abs(current.volume-.65)<.001,"volume is local to the player");
 q.configure(true,"female",.4,"driver-a",null);Handler.flush();ck(MediaPlayer.current()==current&&first.ends==0,"changing voice never cuts the active phrase");
 C queued=new C(),urgent=new C();q.enqueue("event_new_job","two","web",2,wall.getAsLong()+20000,queued);Handler.flush();q.enqueue("event_trip_failed","three","web",4,wall.getAsLong()+20000,urgent);Handler.flush();
 ck(queued.ends==1&&!queued.played&&urgent.starts==0&&MediaPlayer.current()==current,"one pending slot, higher priority replaces only waiting speech");
 current.complete();Handler.advance(7999);ck(urgent.starts==0,"eight-second silence is respected");Handler.advance(1);ck(urgent.starts==1&&MediaPlayer.current().source.endsWith("female/event_trip_failed.mp3"),"next phrase uses the newly selected female voice");
 MediaPlayer.current().complete();Handler.flush();C replay=new C();q.enqueue("event_trip_failed","three","web",4,wall.getAsLong()+20000,replay);Handler.flush();ck(replay.starts==0&&replay.ends==1,"duplicate event cannot replay");
 Handler.advance(8000);C longClip=new C(),expired=new C();q.enqueue("event_job_started","four","web",3,wall.getAsLong()+20000,longClip);Handler.flush();q.enqueue("event_trip_saved","five","web",3,wall.getAsLong()+1000,expired);Handler.flush();Handler.advance(1500);MediaPlayer.current().complete();Handler.flush();ck(expired.starts==0&&expired.ends==1,"a stale waiting confirmation expires");
 Handler.advance(8000);C beforeMute=new C();q.enqueue("driver_greeting_1","six","web",1,wall.getAsLong()+20000,beforeMute);Handler.flush();q.configure(false,"female",.4,"driver-a",null);Handler.flush();ck(MediaPlayer.playing==0&&beforeMute.ends==1,"mute stops playback explicitly");
 C muted=new C();q.enqueue("event_new_job","seven","web",2,wall.getAsLong()+20000,muted);Handler.flush();ck(muted.starts==0&&muted.ends==1,"muted automation does not speak");
 q.configure(true,"male",.75,"driver-a",null);Handler.flush();Handler.advance(8000);C nativeClip=new C();q.enqueue("event_pro_ready","eight","automation:a",3,wall.getAsLong()+20000,nativeClip);Handler.flush();q.stopWeb(null);Handler.flush();ck(nativeClip.starts==1&&nativeClip.ends==0,"backgrounding the WebView does not stop an automation voice");q.cancelOwner("automation:a");Handler.flush();ck(nativeClip.ends==1,"stopping the owning service releases only its speech");
 C invalid=new C();q.enqueue("../../secret","bad","web",3,wall.getAsLong()+20000,invalid);Handler.flush();ck(invalid.ends==1&&invalid.starts==0,"paths outside the clip whitelist are refused");
 ck(NvuVoicePlayback.get(c)==NvuVoicePlayback.get(c),"all native services resolve one process-wide singleton");
 NvuVoicePlugin plugin=new NvuVoicePlugin();plugin.load();Handler.flush();PluginCall call=new PluginCall();call.data.put("cue","../bad");call.data.put("token","invalid");plugin.play(call);ck(call.rejected!=null,"Capacitor plugin validates clip ids before playback");
 ck(MediaPlayer.maxPlaying==1,"no native or legacy speech ever overlapped");legacy.release();System.out.println("VOICE_NATIVE_JVM_PASS "+checks);
 } }`,
};
try {
  for (const [name, content] of Object.entries(files)) { const target = path.join(tmp, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content); }
  const actual = ['NvuVoicePlayback.java', 'NvuVoicePlugin.java', 'NvuAudioManager.java'].map(name => path.join(root, 'android/app/src/main/java/com/nvu/operacional', name));
  const sources = Object.keys(files).map(name => path.join(tmp, name));
  for (const [command, args] of [['javac', ['--release', '21', '-d', path.join(tmp, 'classes'), ...sources, ...actual]],
    ['java', ['-Dnvu.root=' + root, '-cp', path.join(tmp, 'classes'), 'com.nvu.operacional.VoiceTest']]]) {
    const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 60_000 });
    process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
    assert.equal(result.error, undefined); assert.equal(result.status, 0, command + ' failed');
  }
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
