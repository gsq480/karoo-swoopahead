package au.com.fjellconsulting.swoopahead

import android.content.Context
import java.util.UUID

/**
 * What the rider chose on the app's screen. Every value is a pick from a short list, so nothing
 * typed can break it.
 */
class Prefs(context: Context) {
    private val prefs = context.getSharedPreferences("swoopahead", Context.MODE_PRIVATE)

    /** How far out the warning comes. One of [WARN_CHOICES]. */
    var warnM: Int
        get() = prefs.getInt("warn_m", 250).let { if (it in WARN_CHOICES) it else 250 }
        set(value) = prefs.edit().putInt("warn_m", value).apply()

    /** Sound with the warning. */
    var beep: Boolean
        get() = prefs.getBoolean("beep", true)
        set(value) = prefs.edit().putBoolean("beep", value).apply()

    /** Send marked swoops to the shared map. Off keeps them on this Karoo only. */
    var share: Boolean
        get() = prefs.getBoolean("share", true)
        set(value) = prefs.edit().putBoolean("share", value).apply()

    /**
     * A random id made once for this install. It goes with a marked swoop so the shared map can
     * tell one Karoo sending junk from many riders reporting one bird. It names nobody.
     */
    val install: String
        get() = prefs.getString("install", null) ?: UUID.randomUUID().toString().also {
            prefs.edit().putString("install", it).apply()
        }

    companion object {
        val WARN_CHOICES = listOf(150, 250, 400)
    }
}
