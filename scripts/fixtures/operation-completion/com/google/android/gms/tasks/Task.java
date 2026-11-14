package com.google.android.gms.tasks;
import java.util.ArrayList;
import java.util.List;
public final class Task<T> {
    public interface Listener<T> { void onComplete(Task<T> task); }
    private final List<Listener<T>> listeners = new ArrayList<>();
    private boolean complete, successful;
    private T result;
    private Exception error;
    public Task<T> addOnCompleteListener(Listener<T> listener) {
        if (complete) listener.onComplete(this); else listeners.add(listener);
        return this;
    }
    public boolean isSuccessful() { return successful; }
    public T getResult() { return result; }
    public Exception getException() { return error; }
    public void fail(Exception failure) { error = failure; finish(null, false); }
    public void finish(T value, boolean success) {
        result = value; successful = success; complete = true;
        for (Listener<T> listener : new ArrayList<>(listeners)) listener.onComplete(this);
        listeners.clear();
    }
}
