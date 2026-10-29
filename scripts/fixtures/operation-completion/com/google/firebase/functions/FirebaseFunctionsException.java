package com.google.firebase.functions;
public final class FirebaseFunctionsException extends Exception {
    public enum Code { INVALID_ARGUMENT, UNAUTHENTICATED, FAILED_PRECONDITION, NOT_FOUND, UNAVAILABLE }
    public Code getCode() { return Code.UNAVAILABLE; }
    public Object getDetails() { return null; }
}
