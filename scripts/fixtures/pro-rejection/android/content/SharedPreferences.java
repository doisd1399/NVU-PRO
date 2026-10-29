package android.content;
public interface SharedPreferences {
 java.util.Map<String, ?> getAll();
 String getString(String k,String d); boolean getBoolean(String k,boolean d); int getInt(String k,int d); long getLong(String k,long d); boolean contains(String k); Editor edit();
 interface Editor { Editor clear(); Editor remove(String k); Editor putString(String k,String v); Editor putBoolean(String k,boolean v); Editor putInt(String k,int v); Editor putLong(String k,long v); boolean commit(); void apply(); }
}
