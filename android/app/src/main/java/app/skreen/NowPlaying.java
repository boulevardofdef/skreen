package app.skreen;

import android.content.ComponentName;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.provider.Settings;
import android.util.Base64;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.util.List;

/** What the tablet's music app is playing, and its play / pause / skip buttons. */
final class NowPlaying {
    private NowPlaying() { }

    static boolean hasAccess(Context c) {
        String enabled = Settings.Secure.getString(c.getContentResolver(), "enabled_notification_listeners");
        return enabled != null && enabled.contains(c.getPackageName());
    }

    /** The playing app's session, else the first one; Skreen's own audio (radio) is left out. */
    private static MediaController pick(Context c) {
        if (!hasAccess(c)) return null;
        try {
            MediaSessionManager m = (MediaSessionManager) c.getSystemService(Context.MEDIA_SESSION_SERVICE);
            List<MediaController> all = m.getActiveSessions(new ComponentName(c, NowPlayingService.class));
            MediaController first = null;
            for (MediaController mc : all) {
                if (c.getPackageName().equals(mc.getPackageName())) continue;
                if (first == null) first = mc;
                PlaybackState s = mc.getPlaybackState();
                if (s != null && s.getState() == PlaybackState.STATE_PLAYING) return mc;
            }
            return first;
        } catch (SecurityException | NullPointerException e) {
            return null;
        }
    }

    /** {access, active, playing, title, artist, album, app, key, canPrev, canNext} as JSON. */
    static String json(Context c) {
        JSONObject o = new JSONObject();
        try {
            boolean access = hasAccess(c);
            o.put("access", access);
            MediaController mc = access ? pick(c) : null;
            o.put("active", mc != null);
            if (mc != null) {
                MediaMetadata md = mc.getMetadata();
                PlaybackState st = mc.getPlaybackState();
                String title = md == null ? "" : str(md.getString(MediaMetadata.METADATA_KEY_TITLE));
                String artist = md == null ? "" : first(md.getString(MediaMetadata.METADATA_KEY_ARTIST), md.getString(MediaMetadata.METADATA_KEY_ALBUM_ARTIST));
                o.put("title", title);
                o.put("artist", artist);
                o.put("album", md == null ? "" : str(md.getString(MediaMetadata.METADATA_KEY_ALBUM)));
                o.put("app", appName(c, mc.getPackageName()));
                o.put("playing", st != null && st.getState() == PlaybackState.STATE_PLAYING);
                long a = st == null ? 0 : st.getActions();
                o.put("canPrev", (a & PlaybackState.ACTION_SKIP_TO_PREVIOUS) != 0);
                o.put("canNext", (a & PlaybackState.ACTION_SKIP_TO_NEXT) != 0);
                o.put("key", mc.getPackageName() + "|" + title + "|" + artist);
            }
        } catch (Exception ignored) { }
        return o.toString();
    }

    /** The cover picture, shrunk, as a data address the page can show; empty when there is none. */
    static String art(Context c) {
        MediaController mc = pick(c);
        if (mc == null || mc.getMetadata() == null) return "";
        MediaMetadata md = mc.getMetadata();
        Bitmap b = md.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART);
        if (b == null) b = md.getBitmap(MediaMetadata.METADATA_KEY_ART);
        if (b == null) b = md.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON);
        if (b == null) return "";
        int max = 480, w = b.getWidth(), h = b.getHeight();
        if (Math.max(w, h) > max) {
            float k = (float) max / Math.max(w, h);
            b = Bitmap.createScaledBitmap(b, Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)), true);
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        b.compress(Bitmap.CompressFormat.JPEG, 82, out);
        return "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
    }

    static void control(Context c, String cmd) {
        MediaController mc = pick(c);
        if (mc == null) return;
        MediaController.TransportControls t = mc.getTransportControls();
        switch (cmd) {
            case "play": t.play(); break;
            case "pause": t.pause(); break;
            case "toggle": {
                PlaybackState s = mc.getPlaybackState();
                if (s != null && s.getState() == PlaybackState.STATE_PLAYING) t.pause(); else t.play();
                break;
            }
            case "next": t.skipToNext(); break;
            case "prev": t.skipToPrevious(); break;
            default: break;
        }
    }

    /** Asks the music app that has a session to search for the words and play the best match. */
    static boolean search(Context c, String query) {
        MediaController mc = pick(c);
        if (mc == null || query == null || query.trim().isEmpty()) return false;
        mc.getTransportControls().playFromSearch(query.trim(), new android.os.Bundle());
        return true;
    }

    private static String appName(Context c, String pkg) {
        try {
            PackageManager pm = c.getPackageManager();
            ApplicationInfo ai = pm.getApplicationInfo(pkg, 0);
            return String.valueOf(pm.getApplicationLabel(ai));
        } catch (Exception e) {
            return "";
        }
    }

    private static String str(String s) { return s == null ? "" : s; }
    private static String first(String a, String b) { return a != null && !a.isEmpty() ? a : str(b); }
}
