package au.com.fjellconsulting.swoopahead

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import io.hammerhead.karooext.KarooSystemService
import io.hammerhead.karooext.models.HttpResponseState
import io.hammerhead.karooext.models.OnHttpResponse
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import kotlin.coroutines.resume

/**
 * The one way this app talks to the shared map. On Wi-Fi it goes straight out. On a ride the
 * Karoo turns Wi-Fi off, so the ask goes through the phone's Hammerhead app. Keep bodies small:
 * the phone passes on 100 KB at most.
 *
 * Both calls answer with the body of a 200, or null for anything else. A POST can arrive over
 * Wi-Fi, time out, and be sent again through the phone, so whatever is posted must be safe to
 * receive twice.
 */
class Http(private val context: Context, private val karoo: KarooSystemService) {
    suspend fun get(path: String): String? = ask("GET", path, null)

    suspend fun post(path: String, json: String): String? = ask("POST", path, json)

    private suspend fun ask(method: String, path: String, body: String?): String? =
        (if (onWifi) direct(method, path, body) else null) ?: road(method, path, body)

    private val onWifi: Boolean
        get() {
            val manager = context.getSystemService(ConnectivityManager::class.java) ?: return false
            val network = manager.activeNetwork ?: return false
            return manager.getNetworkCapabilities(network)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
        }

    private suspend fun direct(method: String, path: String, body: String?): String? = withContext(Dispatchers.IO) {
        try {
            val connection = URL(ADDRESS + path).openConnection() as HttpURLConnection
            try {
                connection.requestMethod = method
                connection.connectTimeout = 5_000
                connection.readTimeout = 8_000
                if (body != null) {
                    connection.doOutput = true
                    connection.setRequestProperty("Content-Type", "application/json")
                    connection.outputStream.use { it.write(body.toByteArray()) }
                }
                if (connection.responseCode == 200) connection.inputStream.use { it.readBytes().decodeToString() } else null
            } finally {
                connection.disconnect()
            }
        } catch (_: IOException) {
            null // no way out on this Wi-Fi: the phone is tried next
        }
    }

    private suspend fun road(method: String, path: String, body: String?): String? = withTimeoutOrNull(ROAD_TIMEOUT_MS) {
        suspendCancellableCoroutine { cont ->
            var id: String? = null
            val headers = if (body != null) mapOf("Content-Type" to "application/json") else emptyMap()
            id = karoo.addConsumer(
                OnHttpResponse.MakeHttpRequest(method, ADDRESS + path, headers, body?.toByteArray(), waitForConnection = false),
                onError = { _ ->
                    id?.let(karoo::removeConsumer)
                    if (cont.isActive) cont.resume(null)
                },
            ) { event: OnHttpResponse ->
                val state = event.state
                if (state is HttpResponseState.Complete) {
                    id?.let(karoo::removeConsumer)
                    if (cont.isActive) {
                        cont.resume(if (state.error != null || state.statusCode != 200) null else state.body?.decodeToString())
                    }
                }
            }
            cont.invokeOnCancellation { id?.let(karoo::removeConsumer) }
        }
    }

    companion object {
        /** The shared map and its service. */
        const val ADDRESS = "https://swoopahead.pages.dev"
        /** A locked phone can take well over the usual two seconds to pass an ask along. */
        const val ROAD_TIMEOUT_MS = 20_000L
    }
}
