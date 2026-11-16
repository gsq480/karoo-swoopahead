package au.com.fjellconsulting.swoopahead.swoop

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SwoopRuleTest {
    private val lat0 = -35.3
    private val lng0 = 149.1
    private val tree = Spot(1, lat0, lng0, "Northbourne Ave", "2026-11-03", 3)

    /** A point `metres` north of the tree (negative is south). */
    private fun north(metres: Double, atMs: Long) = Fix(lat0 + metres / 111_195.0, lng0, atMs)

    /** Ride along the north-south line through the tree, one fix a second, and collect the warnings. */
    private fun ride(
        rule: SwoopRule, from: Double, to: Double, startMs: Long, spots: List<Spot> = listOf(tree),
        speed: Double = 8.0, recording: Boolean = true,
    ): Pair<List<Warning>, Long> {
        val out = ArrayList<Warning>()
        val step = if (to >= from) speed else -speed
        var at = from
        var ms = startMs
        while (if (step > 0) at <= to else at >= to) {
            rule.onFix(north(at, ms), spots, 250, recording)?.let { out += it }
            at += step
            ms += 1000
        }
        return out to ms
    }

    @Test fun measuresAHundredMetres() {
        val a = north(0.0, 0)
        val b = north(100.0, 0)
        assertEquals(100.0, Geo.metres(a.lat, a.lng, b.lat, b.lng), 0.5)
    }

    @Test fun warnsOnceOnTheWayIn() {
        val (warnings, _) = ride(SwoopRule(), from = 1000.0, to = -1000.0, startMs = 0)
        assertEquals(1, warnings.size)
        assertEquals(tree, warnings[0].spot)
        assertTrue("warned at ${warnings[0].metres} m", warnings[0].metres in 240..250)
    }

    @Test fun silentWhenNoRideIsRecording() {
        val (warnings, _) = ride(SwoopRule(), from = 1000.0, to = -1000.0, startMs = 0, recording = false)
        assertTrue(warnings.isEmpty())
    }

    @Test fun warnsWhenARideStartsUnderTheTree() {
        val rule = SwoopRule()
        // Standing 60 m away with no ride going: tracked, silent.
        for (s in 0 until 5) assertNull(rule.onFix(north(60.0, s * 1000L), listOf(tree), 250, false))
        // The ride starts: the first fix warns.
        assertNotNull(rule.onFix(north(60.0, 5000), listOf(tree), 250, true))
        assertNull(rule.onFix(north(60.0, 6000), listOf(tree), 250, true))
    }

    @Test fun noSecondWarningOnAQuickReturn() {
        val rule = SwoopRule()
        val (first, t1) = ride(rule, 1000.0, -1000.0, 0)
        // Back the other way straight off: about four minutes after the warning, under the five.
        val (second, _) = ride(rule, -1000.0, 1000.0, t1)
        assertEquals(1, first.size)
        assertTrue(second.isEmpty())
    }

    @Test fun warnsAgainAfterFiveMinutesClear() {
        val rule = SwoopRule()
        val (_, t1) = ride(rule, 1000.0, -1000.0, 0)
        val (second, _) = ride(rule, -1000.0, 1000.0, t1 + 6 * 60_000L)
        assertEquals(1, second.size)
    }

    @Test fun staysQuietIfYouNeverGetClear() {
        val rule = SwoopRule()
        val (_, t1) = ride(rule, 600.0, 100.0, 0)
        // Loiter between 100 and 400 m for twenty minutes: never twice the distance clear.
        var ms = t1
        var total = 0
        repeat(20) {
            val (a, t2) = ride(rule, 100.0, 400.0, ms)
            val (b, t3) = ride(rule, 400.0, 100.0, t2)
            total += a.size + b.size
            ms = t3
        }
        assertEquals(0, total)
    }

    @Test fun aSpotThatAppearsBehindYouStaysQuietUntilYouTurnBack() {
        val rule = SwoopRule()
        // Riding south, already 100 m past where a spot is about to arrive in a sync.
        val (before, t1) = ride(rule, 60.0, -100.0, 0, spots = emptyList())
        val (leaving, t2) = ride(rule, -100.0, -200.0, t1)
        assertTrue(before.isEmpty())
        assertTrue("warned while riding away", leaving.isEmpty())
        // Turn round inside the warn distance: this time you are heading for it.
        val (back, _) = ride(rule, -200.0, 0.0, t2)
        assertEquals(1, back.size)
    }

    @Test fun nearestFirstThenTheNextAfterTheGap() {
        val rule = SwoopRule()
        val second = Spot(2, north(-150.0, 0).lat, lng0, null, "2026-10-20", 1)
        val (warnings, _) = ride(rule, 1000.0, -1000.0, 0, spots = listOf(tree, second))
        assertEquals(listOf(1, 2), warnings.map { it.spot.id })
    }

    @Test fun twoSpotsInsideTheGapStillBothWarn() {
        val rule = SwoopRule()
        // 80 m apart at 8 m/s is 10 s, inside the 20 s gap: the second waits, it is not lost.
        val second = Spot(2, north(-80.0, 0).lat, lng0, null, "2026-10-20", 1)
        val times = ArrayList<Long>()
        var at = 1000.0
        var ms = 0L
        while (at >= -1000.0) {
            if (rule.onFix(north(at, ms), listOf(tree, second), 250, true) != null) times += ms
            at -= 8.0
            ms += 1000
        }
        assertEquals(2, times.size)
        assertTrue(times[1] - times[0] >= 20_000L)
    }

    @Test fun theSpotYouJustMarkedDoesNotWarnYou() {
        val rule = SwoopRule()
        val (_, t1) = ride(rule, 500.0, 0.0, 0, spots = emptyList())
        rule.mark(north(0.0, t1))
        // The sync brings your own spot back while you stand there getting your breath.
        for (s in 0 until 30) assertNull(rule.onFix(north(0.0, t1 + s * 1000L), listOf(tree), 250, true))
    }

    @Test fun aMarkWearsOffAfterHalfAnHour() {
        val rule = SwoopRule()
        rule.mark(north(0.0, 0))
        val (warnings, _) = ride(rule, 1000.0, -1000.0, 31 * 60_000L)
        assertEquals(1, warnings.size)
    }

    @Test fun aWiderWarnDistanceWarnsEarlier() {
        val rule = SwoopRule()
        var first: Warning? = null
        var at = 1500.0
        var ms = 0L
        while (first == null && at > 0) {
            first = rule.onFix(north(at, ms), listOf(tree), 600, true)
            at -= 8.0
            ms += 1000
        }
        assertTrue("warned at ${first?.metres} m", first!!.metres in 590..600)
    }

    @Test fun nearestForTheField() {
        val far = Spot(2, north(900.0, 0).lat, lng0, null, "2026-10-01", 1)
        val near = SwoopRule.nearest(north(200.0, 0), listOf(far, tree))
        assertEquals(1, near!!.spot.id)
        assertEquals(200, near.metres)
        assertNull(SwoopRule.nearest(north(0.0, 0), emptyList()))
    }

    @Test fun theSecondLineOfTheWarning() {
        assertEquals("180 m · Northbourne Ave · last 3 Nov", SwoopRule.detail(Warning(tree, 184)))
        assertEquals("250 m · last 20 Oct", SwoopRule.detail(Warning(Spot(2, 0.0, 0.0, null, "2026-10-20", 1), 249)))
        assertEquals("40 m", SwoopRule.detail(Warning(Spot(3, 0.0, 0.0, " ", "soon", 1), 38)))
        assertEquals("1.2 km", SwoopRule.distance(1234))
    }
}
