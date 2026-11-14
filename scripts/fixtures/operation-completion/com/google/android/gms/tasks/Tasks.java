package com.google.android.gms.tasks;
public final class Tasks {
    // SDK boundary double: fixture Tasks settle synchronously. Deadline
    // scheduling belongs to Google Play services and is not simulated here.
    public static <T> Task<T> withTimeout(Task<T> task, long timeout, java.util.concurrent.TimeUnit unit) {
        return task;
    }
}
