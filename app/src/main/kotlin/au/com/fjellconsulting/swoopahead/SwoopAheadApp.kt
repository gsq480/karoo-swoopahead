package au.com.fjellconsulting.swoopahead

import android.app.Application
import android.content.Context
import au.com.fjellconsulting.swoopahead.swoop.SwoopWatch
import io.hammerhead.karooext.KarooSystemService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

/**
 * Holds the link to the Karoo's own services, the one client that talks to the shared map, the
 * rider's settings, and the magpie watch, which runs from the moment the Karoo starts this app.
 */
class SwoopAheadApp : Application() {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    lateinit var karoo: KarooSystemService
        private set
    lateinit var http: Http
        private set
    lateinit var prefs: Prefs
        private set
    lateinit var swoops: SwoopWatch
        private set

    override fun onCreate() {
        super.onCreate()
        karoo = KarooSystemService(this)
        karoo.connect()
        http = Http(this, karoo)
        prefs = Prefs(this)
        swoops = SwoopWatch(this)
        swoops.start()
    }
}

val Context.swoopAhead: SwoopAheadApp get() = applicationContext as SwoopAheadApp
