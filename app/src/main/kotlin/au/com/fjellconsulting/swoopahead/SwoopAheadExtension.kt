package au.com.fjellconsulting.swoopahead

import au.com.fjellconsulting.swoopahead.swoop.SwoopField
import io.hammerhead.karooext.extension.KarooExtension
import io.hammerhead.karooext.internal.Emitter
import io.hammerhead.karooext.models.HideSymbols
import io.hammerhead.karooext.models.MapEffect
import io.hammerhead.karooext.models.ShowSymbols
import io.hammerhead.karooext.models.Symbol

/**
 * Registers Swoop Ahead with the Karoo. It carries the Magpie field for ride pages, the "Mark a
 * swoop" button action (which a rider can map to a button), and the swooping spots as caution
 * pins on the Karoo's map. The Karoo starts this when it starts, which starts the app and with
 * it the magpie watch.
 */
class SwoopAheadExtension : KarooExtension("swoopahead", "0.1.0") {
    override val types by lazy { listOf(SwoopField(extension)) }

    override fun onBonusAction(actionId: String) {
        if (actionId == MARK_SWOOP) swoopAhead.swoops.mark()
    }

    override fun startMap(emitter: Emitter<MapEffect>) {
        val swoops = swoopAhead.swoops
        var shown = emptySet<String>()
        fun draw() {
            val symbols = swoops.spots.map {
                Symbol.POI("swoop-${it.id}", it.lat, it.lng, Symbol.POI.Types.CAUTION, it.name?.takeIf(String::isNotBlank) ?: "Magpie")
            }
            val ids = symbols.mapTo(HashSet()) { it.id }
            val gone = shown - ids
            if (gone.isNotEmpty()) emitter.onNext(HideSymbols(gone.toList()))
            if (symbols.isNotEmpty()) emitter.onNext(ShowSymbols(symbols))
            shown = ids
        }
        draw()
        val stop = swoops.listen { draw() }
        emitter.setCancellable { stop() }
    }

    companion object {
        const val MARK_SWOOP = "mark-swoop"
    }
}
