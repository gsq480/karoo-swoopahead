package au.com.fjellconsulting.swoopahead.swoop

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MarkWindowTest {
    private val t0 = 1_000_000L

    @Test fun `the first press starts a mark and opens the window`() {
        val w = MarkWindow()
        assertEquals(MarkWindow.Press.STARTED, w.press(t0))
        assertTrue(w.open(t0 + 1))
        assertEquals(15, w.secondsLeft(t0))
        assertEquals(15, w.secondsLeft(t0 + 1))
        assertEquals(1, w.secondsLeft(t0 + 14_999))
    }

    @Test fun `a second press inside the window cancels it`() {
        val w = MarkWindow()
        w.press(t0)
        assertEquals(MarkWindow.Press.CANCELLED, w.press(t0 + 6_000))
        assertFalse(w.open(t0 + 6_001))
        assertNull(w.secondsLeft(t0 + 6_001))
        assertFalse("a cancelled mark is never kept", w.due(t0 + 20_000))
    }

    @Test fun `left alone, the mark is kept once and only once`() {
        val w = MarkWindow()
        w.press(t0)
        assertFalse(w.due(t0 + 14_999))
        assertTrue(w.due(t0 + 15_000))
        assertFalse(w.due(t0 + 15_001))
        assertNull(w.secondsLeft(t0 + 15_001))
    }

    @Test fun `a press after the window has run out starts a new mark`() {
        val w = MarkWindow()
        w.press(t0)
        assertFalse(w.open(t0 + 15_000))
        assertTrue(w.due(t0 + 15_000))
        assertEquals(MarkWindow.Press.STARTED, w.press(t0 + 16_000))
    }

    @Test fun `press, cancel, press again marks`() {
        val w = MarkWindow()
        w.press(t0)
        w.press(t0 + 2_000)
        assertEquals(MarkWindow.Press.STARTED, w.press(t0 + 4_000))
        assertTrue(w.due(t0 + 19_000))
    }

    @Test fun `nothing is due before any press`() {
        assertFalse(MarkWindow().due(t0))
        assertFalse(MarkWindow().open(t0))
    }
}
