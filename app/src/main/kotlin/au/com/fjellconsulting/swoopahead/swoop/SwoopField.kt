package au.com.fjellconsulting.swoopahead.swoop

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.widget.RemoteViews
import au.com.fjellconsulting.swoopahead.R
import au.com.fjellconsulting.swoopahead.swoopAhead
import io.hammerhead.karooext.extension.DataTypeImpl
import io.hammerhead.karooext.internal.ViewEmitter
import io.hammerhead.karooext.models.UpdateGraphicConfig
import io.hammerhead.karooext.models.ViewConfig
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The Magpie field: how far the nearest swooping spot is, and one tap to mark a swoop where you
 * are. For fifteen seconds after a mark it reads "Tap to cancel", and a second tap takes the
 * mark back. It turns orange inside the warn distance. The warning itself does not need this field on
 * a page; [SwoopWatch] raises it either way.
 */
class SwoopField(extension: String) : DataTypeImpl(extension, TYPE_ID) {
    override fun startView(context: Context, config: ViewConfig, emitter: ViewEmitter) {
        val app = context.swoopAhead
        emitter.onNext(UpdateGraphicConfig(showHeader = false))
        if (config.preview) {
            emitter.updateView(render(context, "180 m", "Magpie · tap to mark a swoop", true))
            return
        }
        val job = app.scope.launch {
            var shown: Triple<String, String, Boolean>? = null
            while (true) {
                val near = app.swoops.nearest
                val cancel = app.swoops.cancelSecondsLeft
                val look = when {
                    cancel != null -> Triple("Marked", "Tap to cancel · $cancel s", true)
                    near == null || near.metres > FAR_M -> Triple("CLEAR", "Magpies · tap to mark a swoop", false)
                    else -> Triple(SwoopRule.distance(near.metres), "Magpie · tap to mark a swoop", near.metres <= app.prefs.warnM)
                }
                if (look != shown) {
                    emitter.updateView(render(context, look.first, look.second, look.third))
                    shown = look
                }
                delay(if (cancel != null) COUNTDOWN_MS else REFRESH_MS)
            }
        }
        emitter.setCancellable { job.cancel() }
    }

    private fun render(context: Context, big: String, small: String, close: Boolean): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.field_swoop)
        views.setTextViewText(R.id.swoop_big, big)
        views.setTextViewText(R.id.swoop_small, small)
        views.setInt(R.id.swoop_field, "setBackgroundColor", if (close) ORANGE else Color.BLACK)
        val ink = if (close) Color.BLACK else Color.WHITE
        views.setTextColor(R.id.swoop_big, ink)
        views.setTextColor(R.id.swoop_small, ink)
        views.setInt(R.id.swoop_icon, "setColorFilter", ink)
        val tap = PendingIntent.getBroadcast(
            context, 0, Intent(context, SwoopTapReceiver::class.java).setAction(SwoopTapReceiver.MARK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        views.setOnClickPendingIntent(R.id.swoop_field, tap)
        return views
    }

    companion object {
        const val TYPE_ID = "swoop"
        private const val REFRESH_MS = 2_000L
        /** While a mark can be cancelled the field counts the seconds down. */
        private const val COUNTDOWN_MS = 500L
        /** Past this the field reads CLEAR rather than a distance nobody needs. */
        private const val FAR_M = 2_000
        private val ORANGE = Color.parseColor("#FC5200")
    }
}

/** The field's tap lands here, in the app's own process, and marks a swoop. */
class SwoopTapReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == MARK) context.swoopAhead.swoops.mark()
    }

    companion object {
        const val MARK = "au.com.fjellconsulting.swoopahead.MARK_SWOOP"
    }
}
