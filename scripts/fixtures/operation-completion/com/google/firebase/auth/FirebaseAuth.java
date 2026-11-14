package com.google.firebase.auth;
public final class FirebaseAuth {
    private static final FirebaseAuth INSTANCE = new FirebaseAuth();
    public static FirebaseUser user;
    public static FirebaseAuth getInstance() { return INSTANCE; }
    public FirebaseUser getCurrentUser() { return user; }
}
