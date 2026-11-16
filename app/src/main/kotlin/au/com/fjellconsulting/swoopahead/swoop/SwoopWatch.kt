package au.com.fjellconsulting.swoopahead.swoop

import android.util.Log
import au.com.fjellconsulting.swoopahead.R
import au.com.fjellconsulting.swoopahead.SwoopAheadApp
import io.hammerhead.karooext.models.InRideAlert
import io.hammerhead.karooext.models.OnLocationChanged
import io.hammerhead.karooext.models.PlayBeepPattern
import io.hammerhead.karooext.models.PlayBeepPattern.Tone
import io.hammerhead.karooext.models.RideState
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Instant
import java.util.Locale
import java.util.UUID
import java.util.concurrent.CopyOnWriteArraySet

/**
 * Watches the ride for magpie swooping spots. Runs for as long as the app's process does, with
 * or without a field on screen.
 *
 * - Every GPS fix goes to [SwoopRule] with the Karoo's own copy of the spots, so a warning needs
 *   no link to anything.
 * - The list is fetched from the shared map when the app starts, then every `sync_min` minutes
 *   during a ride and every six hours otherwise. The ask carries the Karoo's position rounded to
 *   a tenth of a degree (about 10 km), and the map sends the nearest spots.
 * - A swoop the rider marks can be cancelled for fifteen seconds by one more press ([MarkWindow]).
 *   After that it is kept on the Karoo. With sharing on it is also sent to the shared map, and
 *   waits on the Karoo until the map has it.
 *
 * Everything here runs on the app's main-thread scope: the Karoo's callbacks, the field's tap and
 * the button action all hop onto it, so the rule's state has one writer.
 */
class SwoopWatch(private val app: SwoopAheadApp) {
    val store = SwoopStore(app)
    private val rule = SwoopRule()
    private val window = MarkWindow()
    private var pending: Triple<Tap, Mark, Fix>? = null
    private val listeners = CopyOnWriteArraySet<() -> Unit>()
    private var started = false
    private var recording = false
    private var lastFix: Fix? = null
    private var lastHeading: Double? = null
    private var lastAskMs = 0L
    private var askFailed = false
    private var asking = false

    /** Every spot to warn for right now. */
    val spots: List<Spot> get() = store.spots(System.currentTimeMillis())

    /** The nearest spot and how far, from the last fix. Null with no fix or no spots. */
    val nearest: Warning? get() = lastFix?.takeIf { fresh(it) }?.let { SwoopRule.nearest(it, spots) }

    /** Seconds left to cancel the mark just made, or null when there is none to cancel. */
    val cancelSecondsLeft: Int? get() = window.secondsLeft(System.currentTimeMillis())

    /** True when the last try to reach the shared map got no answer. */
    val offline: Boolean get() = askFailed

    fun start() {
        if (started) return
        started = true
        app.karoo.addConsumer { event: OnLocationChanged ->
            app.scope.launch { onFix(Fix(event.lat, event.lng, System.currentTimeMillis()), event.orientation) }
        }
        app.karoo.addConsumer { state: RideState ->
            app.scope.launch {
                val now = state is RideState.Recording
                val starting = now && !recording
                recording = now
                if (starting) { // a ride has started: ask for the list now
                    lastAskMs = 0L
                    talk()
                }
            }
        }
        app.scope.launch {
            while (true) {
                talk()
                delay(TICK_MS)
            }
        }
    }

    /** Called when the spots or the rider's distance to them may have changed. */
    fun listen(listener: () -> Unit): () -> Unit {
        listeners += listener
        return { listeners -= listener }
    }

    private fun onFix(fix: Fix, heading: Double?) {
        val first = lastFix == null
        lastFix = fix
        if (heading != null) lastHeading = heading
        if (first) app.scope.launch { talk() } // the first fix since the app started: now it can ask for what is near
        val warning = rule.onFix(fix, store.spots(fix.atMs), app.prefs.warnM, recording) ?: return
        Log.i(TAG, "warn spot ${warning.spot.id} at ${warning.metres} m")
        show("swoop-${warning.spot.id}", "Magpie ahead", SwoopRule.detail(warning), WARN_MS)
        if (app.prefs.beep) app.karoo.dispatch(PlayBeepPattern(WARN_BEEP))
    }

    /**
     * A press on the Magpie field or the "Mark a swoop" button. The first press marks a swoop where
     * the Karoo is. One more press within fifteen seconds cancels it, and nothing is sent.
     */
    fun mark() {
        app.scope.launch {
            val now = System.currentTimeMillis()
            if (window.due(now)) keep()
            if (window.open(now)) {
                window.press(now)
                pending = null
                Log.i(TAG, "mark cancelled inside the window")
                show("swoop-mark", "Mark cancelled", "Nothing was sent", MARK_MS)
                app.karoo.dispatch(PlayBeepPattern(CANCEL_BEEP))
                listeners.forEach { it() }
                return@launch
            }
            val fix = lastFix
            if (fix == null || !fresh(fix)) {
                Log.i(TAG, "mark refused: no fresh fix")
                show("swoop-mark", "No GPS fix", "Swoop not marked", MARK_MS)
                return@launch
            }
            window.press(now)
            val tap = Tap(fix.lat, fix.lng, lastHeading, Instant.ofEpochMilli(fix.atMs).toString(), "karoo-${UUID.randomUUID()}")
            pending = Triple(tap, Mark(fix.lat, fix.lng, fix.atMs), fix)
            Log.i(TAG, "marked a swoop, ${window.windowMs / 1000} s to cancel")
            show("swoop-mark", "Swoop marked", "Tap again within ${window.windowMs / 1000} s to cancel", MARK_MS)
            app.karoo.dispatch(PlayBeepPattern(MARK_BEEP))
            listeners.forEach { it() }
            delay(window.windowMs + 100)
            if (window.due(System.currentTimeMillis())) keep()
        }
    }

    /** The window ran out untouched: the mark is real. Keep it, and send it if the rider shares. */
    private fun keep() {
        val (tap, mark, fix) = pending ?: return
        pending = null
        val share = app.prefs.share
        store.add(tap, mark, share)
        rule.mark(fix)
        Log.i(TAG, "kept the mark, ${store.queue.size} waiting, sharing ${if (share) "on" else "off"}")
        listeners.forEach { it() }
        lastAskMs = 0L
        app.scope.launch { talk() }
    }

    /** Undo the newest kept mark. From the app's screen. */
    fun removeLastMark(): Boolean = store.removeLastMark(System.currentTimeMillis()).also {
        if (it) {
            listeners.forEach { l -> l() }
            lastAskMs = 0L
            app.scope.launch { talk() }
        }
    }

    /** Shows the warning and plays its beep with a made-up spot, to see and hear it at the desk. */
    fun demo() {
        show("swoop-demo", "Magpie ahead", SwoopRule.detail(Warning(Spot(0, 0.0, 0.0, "Test spot", "2026-11-03", 1), 250)), WARN_MS)
        if (app.prefs.beep) app.karoo.dispatch(PlayBeepPattern(WARN_BEEP))
    }

    /** Ask the shared map now, whatever the clock says. For the app's screen. */
    fun syncNow() {
        app.scope.launch {
            lastAskMs = 0L
            askFailed = false
            talk()
        }
    }

    /** Send what is waiting, then fetch the list if it is due. One conversation at a time. */
    private suspend fun talk() {
        if (asking) return
        val here = lastFix?.takeIf { fresh(it) } ?: return // no position yet: nothing to ask about
        val now = System.currentTimeMillis()
        val every = when {
            askFailed -> RETRY_MS
            recording -> store.config.syncMin * 60_000L
            else -> IDLE_SYNC_MS
        }
        if (now - lastAskMs < every) return
        asking = true
        lastAskMs = now
        try {
            var ok = true
            if (!app.prefs.share) store.dropQueue()
            for ((uid, askedMs) in store.cancels) {
                // Asked more than a day ago: the shared map no longer takes it back, so stop asking.
                if (now - askedMs > CANCEL_GIVE_UP_MS || app.http.post("/api/reports/cancel", """{"uid":"$uid","install":"${app.prefs.install}"}""") != null) {
                    store.cancelDone(uid)
                    Log.i(TAG, "took a mark back off the shared map, ${store.cancels.size} still to go")
                } else {
                    ok = false
                    break
                }
            }
            for (tap in store.queue) {
                if (app.http.post("/api/reports", tap.json(app.prefs.install)) != null) {
                    store.sent(tap.uid)
                    Log.i(TAG, "sent a marked swoop, ${store.queue.size} waiting")
                } else {
                    ok = false
                    break
                }
            }
            // A tenth of a degree is about 10 km: enough for "what is near me", and no more.
            val body = app.http.get(String.format(Locale.US, "/api/spots?lat=%.1f&lng=%.1f", here.lat, here.lng))
            if (body != null && store.take(body, System.currentTimeMillis())) {
                Log.i(TAG, "synced ${store.pool.size} spots, on=${store.config.on}")
                listeners.forEach { it() }
            } else {
                ok = false
                Log.i(TAG, "sync got no answer")
            }
            askFailed = !ok
        } finally {
            asking = false
        }
    }

    private fun show(id: String, title: String, detail: String, ms: Long) {
        app.karoo.dispatch(InRideAlert(id, R.drawable.ic_magpie, title, detail, ms, R.color.swoop_orange, R.color.swoop_ink))
    }

    private fun fresh(fix: Fix) = System.currentTimeMillis() - fix.atMs < FRESH_MS

    companion object {
        const val TAG = "SwoopAhead"
        private const val TICK_MS = 60_000L
        private const val RETRY_MS = 5 * 60_000L
        private const val IDLE_SYNC_MS = 6 * 60 * 60_000L
        private const val FRESH_MS = 30_000L
        private const val WARN_MS = 8_000L
        private const val MARK_MS = 4_000L
        /** Three rising notes. */
        private val WARN_BEEP = listOf(Tone(1400, 140), Tone(null, 60), Tone(1900, 140), Tone(null, 60), Tone(2500, 220))
        private val MARK_BEEP = listOf(Tone(2500, 90), Tone(null, 50), Tone(1900, 90))
        /** Two low notes: it is gone. */
        private val CANCEL_BEEP = listOf(Tone(1200, 110), Tone(null, 50), Tone(900, 160))
        private const val CANCEL_GIVE_UP_MS = 25 * 60 * 60_000L
    }
}
