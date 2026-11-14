package com.google.firebase.firestore;
import java.util.Map;
public final class DocumentSnapshot {
    private final Map<String, Object> fields;
    public DocumentSnapshot(Map<String, Object> values) { fields = values; }
    public boolean exists() { return fields != null; }
    public Object get(String key) { return fields == null ? null : fields.get(key); }
    public String getString(String key) { return (String)get(key); }
    public Map<String, Object> getData() { return fields; }
}
