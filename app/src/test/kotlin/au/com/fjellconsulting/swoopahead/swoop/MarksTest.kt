package au.com.fjellconsulting.swoopahead.swoop

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.time.ZonedDateTime

class MarksTest {
    private val zone = ZoneId.of("Australia/Sydney")
    private val lat0 = -35.3
    private val lng0 = 149.1
    private fun north(metres: Double) = lat0 + metres / 111_195.0
    private fun at(year: Int, month: Int, day: Int) = ZonedDateTime.of(year, month, day, 9, 0, 0, 0, zone).toInstant().toEpochMilli()
    private val october = at(2026, 10, 10)

    @Test fun `a mark is kept and warns its owner in season`() {
        val marks = Marks.add(emptyList(), Mark(lat0, lng0, october))
        val spots = Marks.spots(marks, emptyList(), Marks.MONTHS, october + 86_400_000, zone)
        assertEquals(1, spots.size)
        assertEquals("Your mark", spots[0].name)
        assertEquals("2026-10-10", spots[0].last)
        assertTrue(spots[0].id < 0)
    }

    @Test fun `a second mark beside the first replaces it`() {
        var marks = Marks.add(emptyList(), Mark(lat0, lng0, october))
        marks = Marks.add(marks, Mark(north(100.0), lng0, october + 3_600_000))
        assertEquals(1, marks.size)
        assertEquals(october + 3_600_000, marks[0].atMs)
    }

    @Test fun `a mark 400 m away is a second bird`() {
        var marks = Marks.add(emptyList(), Mark(lat0, lng0, october))
        marks = Marks.add(marks, Mark(north(400.0), lng0, october + 3_600_000))
        assertEquals(2, marks.size)
        val ids = Marks.spots(marks, emptyList(), Marks.MONTHS, october + 7_200_000, zone).map { it.id }
        assertEquals(2, ids.toSet().size)
    }

    @Test fun `a mark beside a spot from the shared map is left out`() {
        val marks = listOf(Mark(lat0, lng0, october))
        val pool = listOf(Spot(7, north(60.0), lng0, null, "2026-10-09", 2))
        assertTrue(Marks.spots(marks, pool, Marks.MONTHS, october, zone).isEmpty())
    }

    @Test fun `a mark away from every shared spot still warns`() {
        val marks = listOf(Mark(lat0, lng0, october))
        val pool = listOf(Spot(7, north(900.0), lng0, null, "2026-10-09", 2))
        assertEquals(1, Marks.spots(marks, pool, Marks.MONTHS, october, zone).size)
    }

    @Test fun `nothing warns outside the swooping months`() {
        val marks = listOf(Mark(lat0, lng0, october))
        assertTrue(Marks.spots(marks, emptyList(), Marks.MONTHS, at(2027, 1, 15), zone).isEmpty())
        assertFalse(Marks.inSeason(Marks.MONTHS, at(2027, 7, 31), zone))
        assertTrue(Marks.inSeason(Marks.MONTHS, at(2027, 8, 1), zone))
    }

    @Test fun `last season's mark warns again next season`() {
        val marks = listOf(Mark(lat0, lng0, october))
        assertEquals(1, Marks.spots(marks, emptyList(), Marks.MONTHS, at(2027, 9, 1), zone).size)
    }

    @Test fun `a mark from three seasons back is dropped`() {
        val marks = listOf(Mark(lat0, lng0, october))
        assertTrue(Marks.spots(marks, emptyList(), Marks.MONTHS, at(2029, 9, 1), zone).isEmpty())
        assertEquals(1, Marks.add(marks, Mark(north(5000.0), lng0, at(2029, 9, 1))).size)
    }

    @Test fun `the shared map can change the months`() {
        val marks = listOf(Mark(lat0, lng0, october))
        assertTrue(Marks.spots(marks, emptyList(), listOf(7, 8, 9), october, zone).isEmpty())
    }
}
