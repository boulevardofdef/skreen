package app.skreen;

import android.service.notification.NotificationListenerService;

/**
 * Empty on purpose. Android only lets an app read what other apps are playing (Spotify, YouTube
 * Music, ...) once the user has granted it "notification access", and that grant is made to a
 * service like this one. Skreen never reads, stores or sends anyone's notifications; the service
 * exists so that {@link NowPlaying} may ask the system for the active media sessions.
 */
public class NowPlayingService extends NotificationListenerService {
}
