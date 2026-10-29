package com.nvu.operacional;
import android.content.Context;
import com.google.firebase.auth.FirebaseUser;
final class GtoFirebaseRuntime {
    static FirebaseUser user;
    static FirebaseUser currentUser(Context context) { return user; }
    static com.google.firebase.functions.FirebaseFunctions functions(Context context, String region) {
        return new com.google.firebase.functions.FirebaseFunctions();
    }
}
