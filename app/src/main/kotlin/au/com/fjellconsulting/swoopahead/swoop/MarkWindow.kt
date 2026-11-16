package au.com.fjellconsulting.swoopahead.swoop

/**
 * The few seconds after a mark in which one more press takes it back. Plain Kotlin, tested on a
 * computer.
 *
 * A thumb lands on the Magpie field by accident often enough that a mark must not be final at
 * once. The first press opens the window. A second press inside it cancels the mark, and nothing
 * leaves the Karoo. When the window runs out untouched, the mark is kept.
 */
class MarkWindow(val windowMs: Long = 15_000L) {
    enum class Press { STARTED, CANCELLED }

    private var openedMs: Long? = null

    /** True while a mark can still be cancelled. */
    fun open(nowMs: Long): Boolean = openedMs?.let { nowMs - it < windowMs } ?: false

    /** A press on the field or the button. */
    fun press(nowMs: Long): Press =
        if (open(nowMs)) {
            openedMs = null
            Press.CANCELLED
        } else {
            openedMs = nowMs
            Press.STARTED
        }

    /** True once, when a window has run out with no second press: the mark is now kept. */
    fun due(nowMs: Long): Boolean {
        val opened = openedMs ?: return false
        if (nowMs - opened < windowMs) return false
        openedMs = null
        return true
    }

    /** Whole seconds left to cancel, rounded up, or null when no window is open. */
    fun secondsLeft(nowMs: Long): Int? {
        val opened = openedMs ?: return null
        val left = windowMs - (nowMs - opened)
        return if (left > 0) ((left + 999) / 1000).toInt() else null
    }
}
