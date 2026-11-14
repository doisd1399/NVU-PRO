package org.json;
import java.util.*;
public class JSONArray {
 final List<String> values=new ArrayList<>();
 public JSONArray(){}
 public JSONArray(String raw) throws JSONException {
  if(raw==null||!raw.startsWith("[")||!raw.endsWith("]")) throw new JSONException();
  String body=raw.substring(1,raw.length()-1).trim();
  if(!body.isEmpty())for(String v:body.split(",")) values.add(v.trim().replace("\"",""));
 }
 public int length(){return values.size();}
 public String optString(int i,String d){return i>=0&&i<values.size()?values.get(i):d;}
 public JSONArray put(String v){values.add(v);return this;}
 public String toString(){return values.isEmpty()?"[]":"[\""+String.join("\",\"",values)+"\"]";}
}
