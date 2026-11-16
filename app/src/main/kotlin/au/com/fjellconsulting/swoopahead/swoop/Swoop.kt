package au.com.fjellconsulting.swoopahead.swoop

import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/** A magpie swooping spot, as the shared map sends it. `last` is the day of its latest report, YYYY-MM-DD. */
data class Spot(val id: Int, val lat: Double, val lng: Double, val name: String?, val last: String, val n: Int)

/** Where the Karoo is, and when it knew. */
data class Fix(val lat: Double, val lng: Double, val atMs: Long)

/** A spot to warn about now, and how far off it is. */
data class Warning(val spot: Spot, val metres: Int)

object Geo {
    /** Straight-line metres between two points. */
    fun metres(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
        val rad = Math.PI / 180
        val a = sin((lat2 - lat1) * rad / 2).pow(2) +
            cos(lat1 * rad) * cos(lat2 * rad) * sin((lng2 - lng1) * rad / 2).pow(2)
        return 2 * 6_371_000.0 * asin(min(1.0, sqrt(a)))
    }
}

/**
 * Decides when to warn. This file has no Android in it, so the rule is tested on a computer.
 *
 * Feed it every GPS fix with the spots to warn for. It answers with a warning when a spot comes
 * within the warn distance and you are not riding away from it. Which spots exist is the shared
 * map's to decide; the warn distance is the rider's pick.
 *
 * - One warning per pass. A spot warns again after you have been more than twice the warn distance
 *   clear of it and five minutes have gone by.
 * - "Riding away" is judged against where you were 15 to 30 m back, so a stop does not flip it.
 *   With no such point yet (a ride started under the tree) it warns.
 * - Twenty seconds at least between warnings, nearest spot first.
 * - A spot within 300 m of a swoop you marked in the last half hour stays quiet: you know.
 * - Nothing warns unless a ride is recording.
 */
class SwoopRule(
    private val rearmMs: Long = 5 * 60_000L,
    private val gapMs: Long = 20_000L,
    private val muteMs: Long = 30 * 60_000L,
    private val muteM: Double = 300.0,
) {
    private val warnedAt = HashMap<Int, Long>()
    private val marks = ArrayList<Fix>()
    private var lastWarnMs: Long? = null
    private var anchor: Fix? = null
    private var back: Fix? = null

    /** Call when the rider marks a swoop, so the spot it makes does not warn them about itself. */
    fun mark(fix: Fix) {
        marks += fix
    }

    fun onFix(fix: Fix, spots: List<Spot>, warnM: Int, recording: Boolean): Warning? {
        val from = anchor
        if (from == null) anchor = fix
        else if (Geo.metres(from.lat, from.lng, fix.lat, fix.lng) >= TRAIL_M) { back = from; anchor = fix }
        marks.removeAll { fix.atMs - it.atMs > muteMs }
        val behind = back

        var best: Spot? = null
        var bestM = Double.MAX_VALUE
        for (spot in spots) {
            val m = Geo.metres(fix.lat, fix.lng, spot.lat, spot.lng)
            val warned = warnedAt[spot.id]
            if (warned != null) {
                if (m > warnM * CLEAR && fix.atMs - warned >= rearmMs) warnedAt.remove(spot.id) else continue
            }
            if (m > warnM) continue
            if (marks.any { Geo.metres(it.lat, it.lng, spot.lat, spot.lng) <= muteM }) {
                warnedAt[spot.id] = fix.atMs
                continue
            }
            if (behind != null && Geo.metres(behind.lat, behind.lng, spot.lat, spot.lng) + AWAY_M < m) continue
            if (m < bestM) { best = spot; bestM = m }
        }

        val spot = best ?: return null
        if (!recording) return null
        val last = lastWarnMs
        if (last != null && fix.atMs - last < gapMs) return null
        warnedAt[spot.id] = fix.atMs
        lastWarnMs = fix.atMs
        return Warning(spot, bestM.roundToInt())
    }

    companion object {
        private const val CLEAR = 2.0
        private const val TRAIL_M = 15.0
        private const val AWAY_M = 5.0

        /** The nearest spot and its distance, for the field. */
        fun nearest(fix: Fix, spots: List<Spot>): Warning? =
            spots.minByOrNull { Geo.metres(fix.lat, fix.lng, it.lat, it.lng) }
                ?.let { Warning(it, Geo.metres(fix.lat, fix.lng, it.lat, it.lng).roundToInt()) }

        /** "180 m · Northbourne Ave · last 3 Nov": the second line of the warning. */
        fun detail(warning: Warning): String = listOfNotNull(
            distance(warning.metres),
            warning.spot.name?.trim()?.takeIf { it.isNotEmpty() },
            lastText(warning.spot.last),
        ).joinToString(" · ")

        /** To the nearest 10 m under a kilometre, then to a tenth of a kilometre. */
        fun distance(metres: Int): String =
            if (metres < 1000) "${(metres / 10.0).roundToInt() * 10} m"
            else "${(metres / 100.0).roundToInt() / 10.0} km"

        private val MONTHS = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

        /** "2026-11-03" reads "last 3 Nov". Null for anything that is not a date. */
        fun lastText(day: String): String? {
            val parts = day.split("-")
            val month = parts.getOrNull(1)?.toIntOrNull() ?: return null
            val date = parts.getOrNull(2)?.toIntOrNull() ?: return null
            if (parts.size != 3 || month !in 1..12 || date !in 1..31) return null
            return "last $date ${MONTHS[month - 1]}"
        }
    }
}
