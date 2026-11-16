package au.com.fjellconsulting.swoopahead.swoop

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** What the shared map decides and the Karoo only obeys. Defaults hold until the first sync. */
data class SwoopConfig(val on: Boolean = true, val syncMin: Int = 30, val months: List<Int> = Marks.MONTHS)

/** A swoop the rider marked, waiting to reach the shared map. `uid` lets the map count a resend once. */
data class Tap(val lat: Double, val lng: Double, val heading: Double?, val at: String, val uid: String) {
    fun json(install: String? = null): String = JSONObject().apply {
        put("lat", lat)
        put("lng", lng)
        if (heading != null) put("heading", heading)
        put("at", at)
        put("uid", uid)
        if (install != null) put("install", install)
    }.toString()
}

/**
 * What the Karoo holds: its copy of the shared map's spots, the rider's own marks, and the taps
 * not yet sent. Three files, so all of it survives a restart. Warnings are checked against these
 * copies, so a ride with no phone link still warns from the last list it was given, and a mark
 * warns its owner with no link at all.
 */
class SwoopStore(context: Context) {
    private val spotsFile = File(context.filesDir, "swoops.json")
    private val marksFile = File(context.filesDir, "marks.json")
    private val queueFile = File(context.filesDir, "swoop-queue.json")
    private val sentFile = File(context.filesDir, "swoop-sent.json")
    private val cancelsFile = File(context.filesDir, "swoop-cancels.json")

    @Volatile var config = SwoopConfig()
        private set
    /** The shared map's spots near the rider, as of the last sync. */
    @Volatile var pool: List<Spot> = emptyList()
        private set
    @Volatile var syncedAtMs = 0L
        private set
    @Volatile var marks: List<Mark> = emptyList()
        private set
    @Volatile var queue: List<Tap> = emptyList()
        private set
    /** Taps the shared map has, newest last: their uid and when the swoop was. Kept so one can be taken back. */
    @Volatile var sentTaps: List<Pair<String, Long>> = emptyList()
        private set
    /** Taps to take back off the shared map: uid, and when the rider asked. */
    @Volatile var cancels: List<Pair<String, Long>> = emptyList()
        private set

    init {
        runCatching { read(JSONObject(spotsFile.readText())) }
        runCatching {
            val array = JSONArray(marksFile.readText())
            marks = (0 until array.length()).map { i ->
                val m = array.getJSONArray(i)
                Mark(m.getDouble(0), m.getDouble(1), m.getLong(2))
            }
        }
        runCatching { sentTaps = pairs(sentFile) }
        runCatching { cancels = pairs(cancelsFile) }
        runCatching {
            val array = JSONArray(queueFile.readText())
            queue = (0 until array.length()).map { i ->
                val j = array.getJSONObject(i)
                Tap(j.getDouble("lat"), j.getDouble("lng"), if (j.has("heading")) j.getDouble("heading") else null, j.getString("at"), j.getString("uid"))
            }
        }
    }

    /** Every spot to warn for right now: the shared map's, then the rider's own marks. */
    fun spots(nowMs: Long): List<Spot> {
        if (!config.on || !Marks.inSeason(config.months, nowMs)) return emptyList()
        return pool + Marks.spots(marks, pool, config.months, nowMs)
    }

    /** Take the shared map's answer to a sync. False when it was not the answer expected. */
    fun take(body: String, nowMs: Long): Boolean = try {
        val j = JSONObject(body)
        j.getJSONArray("spots") // an answer without the list is not an answer
        j.put("synced_at_ms", nowMs)
        read(j)
        spotsFile.writeText(j.toString())
        true
    } catch (_: Exception) {
        false
    }

    private fun read(j: JSONObject) {
        val array = j.getJSONArray("spots")
        val list = ArrayList<Spot>(array.length())
        for (i in 0 until array.length()) {
            val s = array.getJSONObject(i)
            list += Spot(
                id = s.getInt("id"),
                lat = s.getDouble("lat"),
                lng = s.getDouble("lng"),
                name = if (s.isNull("name")) null else s.optString("name"),
                last = s.optString("last", ""),
                n = s.optInt("n", 1),
            )
        }
        val months = j.optJSONArray("months")?.let { m -> (0 until m.length()).map { m.getInt(it) }.filter { it in 1..12 } }
        config = SwoopConfig(
            on = j.optBoolean("on", true),
            syncMin = j.optInt("sync_min", 30).coerceIn(5, 240),
            months = months?.takeIf { it.isNotEmpty() } ?: Marks.MONTHS,
        )
        pool = list
        syncedAtMs = j.optLong("synced_at_ms", 0L)
    }

    /** Keep a mark on the Karoo, and queue it for the shared map when the rider shares. */
    @Synchronized fun add(tap: Tap, mark: Mark, share: Boolean) {
        marks = Marks.add(marks, mark)
        saveMarks()
        if (share) {
            queue = (queue + tap).takeLast(MAX_WAITING)
            saveQueue()
        }
    }

    @Synchronized fun sent(uid: String) {
        val tap = queue.firstOrNull { it.uid == uid }
        queue = queue.filterNot { it.uid == uid }
        saveQueue()
        if (tap != null) {
            sentTaps = (sentTaps + (uid to java.time.Instant.parse(tap.at).toEpochMilli())).takeLast(MAX_SENT)
            savePairs(sentFile, sentTaps)
        }
    }

    /** The shared map has taken this tap back, or it is too late to ask. */
    @Synchronized fun cancelDone(uid: String) {
        cancels = cancels.filterNot { it.first == uid }
        savePairs(cancelsFile, cancels)
    }

    /**
     * Undo the newest mark. If it had not been sent yet, it never is. If it was sent in the last
     * day, the shared map is asked to take it back the next time there is a link.
     */
    @Synchronized fun removeLastMark(nowMs: Long): Boolean {
        val last = marks.maxByOrNull { it.atMs } ?: return false
        marks = marks - last
        saveMarks()
        queue = queue.filterNot { it.lat == last.lat && it.lng == last.lng }
        saveQueue()
        val sent = sentTaps.firstOrNull { it.second == last.atMs }
        if (sent != null) {
            sentTaps = sentTaps - sent
            savePairs(sentFile, sentTaps)
            cancels = (cancels + (sent.first to nowMs)).takeLast(MAX_SENT)
            savePairs(cancelsFile, cancels)
        }
        return true
    }

    /** Sharing was turned off: nothing still waiting is sent. */
    @Synchronized fun dropQueue() {
        queue = emptyList()
        saveQueue()
    }

    private fun pairs(file: File): List<Pair<String, Long>> {
        val array = JSONArray(file.readText())
        return (0 until array.length()).map { i -> array.getJSONArray(i).let { it.getString(0) to it.getLong(1) } }
    }

    private fun savePairs(file: File, list: List<Pair<String, Long>>) {
        file.writeText(JSONArray(list.map { JSONArray(listOf(it.first, it.second)) }).toString())
    }

    private fun saveMarks() {
        marksFile.writeText(JSONArray(marks.map { JSONArray(listOf(it.lat, it.lng, it.atMs)) }).toString())
    }

    private fun saveQueue() {
        queueFile.writeText(JSONArray(queue.map { JSONObject(it.json()) }).toString())
    }

    companion object {
        /** More taps than this waiting means weeks with no link; the oldest go. */
        private const val MAX_WAITING = 50
        private const val MAX_SENT = 30
    }
}
