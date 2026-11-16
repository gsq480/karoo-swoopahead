package au.com.fjellconsulting.swoopahead.swoop

import java.time.Instant
import java.time.ZoneId

/** A swoop this rider marked, kept on the Karoo whether or not it was sent to the shared map. */
data class Mark(val lat: Double, val lng: Double, val atMs: Long)

/**
 * The rider's own marks, as spots to warn for. Plain Kotlin, tested on a computer.
 *
 * A mark warns its owner the next time they come past, with sharing off and with no link to
 * anything. Marks follow the same two rules the shared map applies to its spots: reports close
 * together are one bird, and nothing warns outside the swooping months.
 */
object Marks {
    /** Marks this close together are one bird's patch, as on the shared map. */
    const val JOIN_M = 150.0
    /** Two seasons and a little: after that a mark is dropped. */
    const val KEEP_MS = 800L * 24 * 3_600_000
    /** The swooping months until the shared map says otherwise. */
    val MONTHS = listOf(8, 9, 10, 11)

    /** The list with one more mark. A mark beside an older one replaces it; stale ones go. */
    fun add(marks: List<Mark>, mark: Mark): List<Mark> =
        marks.filter { mark.atMs - it.atMs < KEEP_MS && Geo.metres(it.lat, it.lng, mark.lat, mark.lng) > JOIN_M } + mark

    /**
     * The marks as spots, for this moment. Empty outside the swooping months. A mark beside a spot
     * the shared map already sent is left out, so one bird never warns twice.
     */
    fun spots(marks: List<Mark>, pool: List<Spot>, months: List<Int>, nowMs: Long, zone: ZoneId = ZoneId.systemDefault()): List<Spot> {
        if (!inSeason(months, nowMs, zone)) return emptyList()
        return marks
            .filter { nowMs - it.atMs < KEEP_MS }
            .filter { mark -> pool.none { Geo.metres(it.lat, it.lng, mark.lat, mark.lng) <= JOIN_M } }
            .map { Spot(idFor(it), it.lat, it.lng, "Your mark", day(it.atMs, zone), 1) }
    }

    /** True in a swooping month, by the Karoo's own clock and time zone. */
    fun inSeason(months: List<Int>, nowMs: Long, zone: ZoneId = ZoneId.systemDefault()): Boolean =
        Instant.ofEpochMilli(nowMs).atZone(zone).monthValue in months

    /** Always negative, so a mark can never be taken for a spot from the shared map. */
    fun idFor(mark: Mark): Int = -1 - ((mark.atMs / 1000) % 1_000_000_000L).toInt()

    private fun day(atMs: Long, zone: ZoneId): String = Instant.ofEpochMilli(atMs).atZone(zone).toLocalDate().toString()
}
