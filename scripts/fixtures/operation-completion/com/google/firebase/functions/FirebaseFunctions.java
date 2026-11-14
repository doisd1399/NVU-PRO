package com.google.firebase.functions;
import java.util.*;
import com.google.android.gms.tasks.Task;
public final class FirebaseFunctions {
    public static final List<Task<Result>> pending = new ArrayList<>();
    public Callable getHttpsCallable(String name) { return new Callable(); }
    public static final class Callable {
        public Task<Result> call(Object request) {
            Task<Result> task = new Task<>(); pending.add(task); return task;
        }
    }
    public static final class Result {
        private final Object data;
        public Result(Object value) { data = value; }
        public Object getData() { return data; }
    }
}
