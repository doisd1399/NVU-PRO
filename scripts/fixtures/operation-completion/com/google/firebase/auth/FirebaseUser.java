package com.google.firebase.auth;
public final class FirebaseUser {
    private final String uid;
    public FirebaseUser(String value) { uid = value; }
    public String getUid() { return uid; }
    public com.google.android.gms.tasks.Task<Object> getIdToken(boolean refresh) {
        com.google.android.gms.tasks.Task<Object> result = new com.google.android.gms.tasks.Task<>();
        result.finish(new Object(), true); return result;
    }
}
