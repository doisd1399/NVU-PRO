package com.google.firebase.firestore;
import com.google.android.gms.tasks.Task;
import java.util.*;
/** No write API exists in this double: the cleaner must only read the server. */
public final class FirebaseFirestore {
    public static final Map<String, Map<String, Object>> documents = new HashMap<>();
    public static final List<Task<DocumentSnapshot>> deferredTasks = new ArrayList<>();
    public static boolean offline, defer;
    public static int reads;
    private static final FirebaseFirestore INSTANCE = new FirebaseFirestore();
    public static FirebaseFirestore getInstance() { return INSTANCE; }
    public Collection collection(String name) {
        if (!"trabalhos".equals(name)) throw new AssertionError("unexpected collection");
        return new Collection();
    }
    public static final class Collection {
        public Document document(String id) { return new Document(id); }
    }
    public static final class Document {
        final String id;
        Document(String value) { id = value; }
        public Task<DocumentSnapshot> get(Source source) {
            if (source != Source.SERVER) throw new AssertionError("cached completion is not proof");
            reads++;
            Task<DocumentSnapshot> task = new Task<>();
            if (defer) deferredTasks.add(task);
            else task.finish(new DocumentSnapshot(documents.get(id)), !offline);
            return task;
        }
    }
    public static void reset() { documents.clear(); deferredTasks.clear(); offline = false; defer = false; reads = 0; }
}
