package ph.kwaderno.payalert

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject
import ph.kwaderno.payalert.core.PayLogic
import ph.kwaderno.payalert.core.Payment

/** A payment the app showed, kept on this phone only. */
data class Received(
    val id: String,
    val at: Long,
    val pkg: String,
    val app: String,
    val amountCentavos: Long,
    val sender: String?,
    val ref: String?,
    val channel: String?,
    val matched: Boolean,
    val dedupKey: String,
)

/** A money-in notification from an app the owner hasn't trusted yet. */
data class Suggestion(val trustKey: String, val pkg: String, val app: String, val sender: String?, val sample: String, val at: Long)

/** Everything is stored on this phone (SharedPreferences). Nothing is sent anywhere. */
class Store(context: Context) {
    val prefs: SharedPreferences = context.applicationContext.getSharedPreferences("payalert", Context.MODE_PRIVATE)

    var trusted: Set<String>
        get() = prefs.getStringSet("trusted", emptySet())!!.toSet()
        set(v) { prefs.edit().putStringSet("trusted", v.toSet()).apply() }

    fun trust(key: String, on: Boolean) {
        trusted = if (on) trusted + key else trusted - key
        if (on) suggestions = suggestions.filter { it.trustKey != key }
    }

    /** Amount the cashier is waiting for (centavos), 0 = none. */
    var expected: Long
        get() = prefs.getLong("expected", 0)
        set(v) { prefs.edit().putLong("expected", v).apply() }

    var voiceOn: Boolean
        get() = prefs.getBoolean("voice", true)
        set(v) { prefs.edit().putBoolean("voice", v).apply() }

    var popupOn: Boolean
        get() = prefs.getBoolean("popup", true)
        set(v) { prefs.edit().putBoolean("popup", v).apply() }

    var payments: List<Received>
        get() = readArr("payments").map { o ->
            Received(o.getString("id"), o.getLong("at"), o.getString("pkg"), o.optString("app"), o.getLong("amount"),
                o.optStringOrNull("sender"), o.optStringOrNull("ref"), o.optStringOrNull("channel"), o.optBoolean("matched"), o.optString("dk"))
        }
        set(v) = writeArr("payments", v.takeLast(300).map { r ->
            JSONObject().put("id", r.id).put("at", r.at).put("pkg", r.pkg).put("app", r.app).put("amount", r.amountCentavos)
                .put("sender", r.sender).put("ref", r.ref).put("channel", r.channel).put("matched", r.matched).put("dk", r.dedupKey)
        })

    var suggestions: List<Suggestion>
        get() = readArr("suggestions").map { o ->
            Suggestion(o.getString("key"), o.getString("pkg"), o.optString("app"), o.optStringOrNull("sender"), o.optString("sample"), o.getLong("at"))
        }
        set(v) = writeArr("suggestions", v.takeLast(20).map { s ->
            JSONObject().put("key", s.trustKey).put("pkg", s.pkg).put("app", s.app).put("sender", s.sender).put("sample", s.sample).put("at", s.at)
        })

    fun recent(): List<PayLogic.Recent> = payments.takeLast(50).map { PayLogic.Recent(it.dedupKey, it.at) }

    fun addPayment(r: Received) { payments = payments + r }

    fun addSuggestion(key: String, pkg: String, app: String, sender: String?, p: Payment, sample: String, now: Long) {
        if (key in trusted) return
        suggestions = suggestions.filter { it.trustKey != key } + Suggestion(key, pkg, app, sender, sample.take(160), now)
    }

    fun clearPayments() { payments = emptyList() }

    private fun readArr(k: String): List<JSONObject> = try {
        val a = JSONArray(prefs.getString(k, "[]")); (0 until a.length()).map { a.getJSONObject(it) }
    } catch (e: Exception) { emptyList() }

    private fun writeArr(k: String, items: List<JSONObject>) {
        val a = JSONArray(); items.forEach { a.put(it) }; prefs.edit().putString(k, a.toString()).apply()
    }

    private fun JSONObject.optStringOrNull(k: String): String? = if (isNull(k) || !has(k)) null else optString(k).ifEmpty { null }
}
