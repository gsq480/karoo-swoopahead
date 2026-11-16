package au.com.fjellconsulting.swoopahead

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView
import au.com.fjellconsulting.swoopahead.swoop.SwoopRule
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * The app's one screen: what it sends and doesn't, what the Karoo holds right now, and every
 * setting as a pick or a switch.
 *
 * It also takes three desk checks over a cable:
 *   adb shell am start -n au.com.fjellconsulting.swoopahead/.SettingsActivity --activity-clear-top --ez demo true
 *   ... --ez sync true      ask the shared map now
 *   ... --ez mark true      mark a swoop where the Karoo is
 */
class SettingsActivity : Activity() {
    private val app get() = swoopAhead
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var status: TextView
    private val tick = object : Runnable {
        override fun run() {
            status.text = statusText()
            handler.postDelayed(this, 2_000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(32))
            setBackgroundColor(Color.BLACK)
        }

        column.addView(text("Swoop Ahead", 26f, bold = true))
        column.addView(text(
            "Warns you about 250 m before a magpie swooping spot. Tap the Magpie field on a ride to mark a swoop.", 16f))

        column.addView(heading("What it sends"))
        column.addView(text(
            "When you mark a swoop, its place, time and direction go to the shared map so other riders are warned too. " +
                "To fetch the spots near you, it sends your position rounded to about 10 km. " +
                "Nothing else: no name, no account, no ride.", 15f, dim = true))
        column.addView(switch("Send my marks to the shared map", app.prefs.share) { on ->
            app.prefs.share = on
            if (!on) app.swoops.store.dropQueue()
        })
        column.addView(text("Off keeps your marks on this Karoo. You are still warned for them.", 14f, dim = true))

        column.addView(heading("Right now"))
        status = text("", 16f)
        column.addView(status)
        column.addView(button("Sync now") { app.swoops.syncNow() })

        column.addView(heading("Warn me this far out"))
        column.addView(RadioGroup(this).apply {
            orientation = RadioGroup.VERTICAL
            for (metres in Prefs.WARN_CHOICES) {
                addView(RadioButton(this@SettingsActivity).apply {
                    id = metres
                    text = "$metres m"
                    textSize = 18f
                    setTextColor(Color.WHITE)
                    minHeight = dp(48)
                })
            }
            check(app.prefs.warnM)
            setOnCheckedChangeListener { _, id -> app.prefs.warnM = id }
        })

        column.addView(heading("Sound"))
        column.addView(switch("Beep with the warning", app.prefs.beep) { app.prefs.beep = it })
        column.addView(button("Test the warning") { app.swoops.demo() })

        column.addView(heading("My marks"))
        column.addView(button("Remove my last mark") {
            val removed = app.swoops.removeLastMark()
            status.text = statusText() + if (removed) "\nLast mark removed from this Karoo." else "\nNo marks to remove."
        })
        column.addView(text(
            "A mark already sent stays on the shared map. Ask for it to be removed at swoopahead.pages.dev.", 14f, dim = true))

        column.addView(heading("About"))
        column.addView(text(
            "Free and open source (Apache 2.0). The map and the code: swoopahead.pages.dev. " +
                "Spots come from riders, and in Victoria from the Victorian Government's swooping bird map (CC BY 4.0). " +
                "Not made or endorsed by Hammerhead or Magpie Alert.", 14f, dim = true))

        setContentView(ScrollView(this).apply {
            setBackgroundColor(Color.BLACK)
            addView(column)
        })
        act(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        act(intent)
    }

    override fun onResume() {
        super.onResume()
        handler.post(tick)
    }

    override fun onPause() {
        handler.removeCallbacks(tick)
        super.onPause()
    }

    private fun act(intent: Intent?) {
        if (intent == null) return
        if (intent.getBooleanExtra("demo", false)) app.swoops.demo()
        if (intent.getBooleanExtra("sync", false)) app.swoops.syncNow()
        if (intent.getBooleanExtra("mark", false)) app.swoops.mark()
    }

    private fun statusText(): String {
        val store = app.swoops.store
        val lines = ArrayList<String>()
        val shared = store.pool.size
        val mine = store.marks.size
        lines += when {
            store.syncedAtMs == 0L -> "No spots fetched yet. It asks once the Karoo has a GPS fix and a link."
            else -> "$shared ${if (shared == 1) "spot" else "spots"} near you from the shared map, fetched ${ago(store.syncedAtMs)}."
        }
        if (app.swoops.offline) lines += "The last try to reach the shared map got no answer."
        lines += "$mine of your own ${if (mine == 1) "mark" else "marks"} kept on this Karoo."
        if (store.queue.isNotEmpty()) lines += "${store.queue.size} waiting to be sent."
        if (app.swoops.spots.isEmpty() && (shared > 0 || mine > 0)) lines += "It's outside the swooping months, so nothing warns."
        val near = app.swoops.nearest
        lines += if (near != null) "Nearest spot: ${SwoopRule.distance(near.metres)}." else "No GPS fix, or no spot nearby."
        return lines.joinToString("\n")
    }

    private fun ago(atMs: Long): String {
        val minutes = (System.currentTimeMillis() - atMs) / 60_000
        return when {
            minutes < 1 -> "just now"
            minutes < 60 -> "$minutes min ago"
            minutes < 48 * 60 -> "${minutes / 60} h ago"
            else -> "on ${SimpleDateFormat("d MMM", Locale.getDefault()).format(Date(atMs))}"
        }
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    private fun text(value: String, size: Float, bold: Boolean = false, dim: Boolean = false) = TextView(this).apply {
        text = value
        textSize = size
        setTextColor(if (dim) Color.parseColor("#B8B8B8") else Color.WHITE)
        if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
        setPadding(0, dp(4), 0, dp(4))
    }

    private fun heading(value: String) = TextView(this).apply {
        text = value.uppercase(Locale.getDefault())
        textSize = 13f
        letterSpacing = 0.08f
        setTextColor(Color.parseColor("#FC5200"))
        setPadding(0, dp(22), 0, dp(4))
    }

    private fun switch(label: String, on: Boolean, changed: (Boolean) -> Unit) = Switch(this).apply {
        text = label
        textSize = 18f
        setTextColor(Color.WHITE)
        isChecked = on
        minHeight = dp(52)
        setOnCheckedChangeListener { _, value -> changed(value) }
    }

    private fun button(label: String, tapped: (View) -> Unit) = Button(this).apply {
        text = label
        textSize = 16f
        isAllCaps = false
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            topMargin = dp(8)
        }
        minHeight = dp(52)
        setOnClickListener(tapped)
    }
}
