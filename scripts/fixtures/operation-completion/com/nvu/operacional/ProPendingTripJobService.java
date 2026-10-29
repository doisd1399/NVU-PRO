package com.nvu.operacional;
import java.util.List;
public final class ProPendingTripJobService {
    static int cancellationNotifications;
    public static void schedulePermissionRecovery(android.content.Context context) {}
    public static void scheduleImmediate(android.content.Context context) {}
    static void onCompletedOperationQueueDiscarded(List<String> ids) { cancellationNotifications++; }
}
