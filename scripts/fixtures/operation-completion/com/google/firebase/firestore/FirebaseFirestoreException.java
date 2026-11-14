package com.google.firebase.firestore;
public final class FirebaseFirestoreException extends Exception {
    public enum Code { PERMISSION_DENIED, UNAVAILABLE }
    public Code getCode() { return Code.UNAVAILABLE; }
}
