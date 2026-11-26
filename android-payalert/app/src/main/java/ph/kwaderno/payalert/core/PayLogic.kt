package ph.kwaderno.payalert.core

/**
 * Decides what to do with one notification. Plain Kotlin so it can be unit-tested.
 *
 * Safety rules:
 *  - Only apps the owner ticked ("trusted") can trigger the "Payment received" pop-up. Android stamps every
 *    notification with the app that posted it, so another app can't pretend to be GCash.
 *  - Text messages are different: anyone can text the phone. For a messaging app the owner trusts one sender
 *    name at a time (e.g. "BDO"), never the whole app.
 *  - Money-in notifications from apps that aren't trusted become suggestions ("Is this your bank app?"),
 *    never pop-ups.
 *  - The same payment posted twice (apps often update a notification) is shown once.
 */
object PayLogic {
    /** Messaging apps: trust is per sender, because anyone can send an SMS. */
    val SMS_APPS = setOf(
        "com.google.android.apps.messaging", "com.samsung.android.messaging", "com.android.mms", "com.android.messaging",
        "com.oneplus.mms", "com.coloros.mms", "com.oppo.mms", "com.vivo.message", "com.huawei.message", "com.hihonor.mms",
        "com.textra", "com.truecaller", "com.microsoft.android.smsorganizer",
    )

    /** Names that suggest a payment app when listing installed apps. */
    val PAYMENT_APP_WORDS = listOf(
        "gcash", "maya", "paymaya", "bdo", "bpi", "metrobank", "unionbank", "landbank", "security bank", "rcbc", "pnb",
        "chinabank", "china bank", "eastwest", "psbank", "gotyme", "seabank", "maribank", "cimb", "tonik", "uno", "komo",
        "ownbank", "aub", "dbp", "ucpb", "robinsons bank", "bank", "shopeepay", "grabpay", "coins.ph", "palawan", "ml wallet",
    )

    const val DUP_WINDOW_MS = 15 * 60 * 1000L

    fun isSmsApp(pkg: String) = pkg in SMS_APPS

    /** What the owner trusts: the app, or for messaging apps the app + sender name. */
    fun trustKey(pkg: String, title: String?): String =
        if (isSmsApp(pkg)) "$pkg|" + (title ?: "").trim().lowercase() else pkg

    fun looksLikePaymentApp(label: String): Boolean {
        val l = label.lowercase()
        return PAYMENT_APP_WORDS.any { w -> Regex("""(^|[^a-z])${Regex.escape(w)}([^a-z]|$)""").containsMatchIn(l) }
    }

    data class Recent(val dedupKey: String, val at: Long)

    sealed class Decision {
        data class Accept(val payment: Payment, val trustKey: String, val dedupKey: String) : Decision()
        data class Suggest(val payment: Payment, val trustKey: String) : Decision()
        data object Duplicate : Decision()
        data object Ignore : Decision()
    }

    fun dedupKey(pkg: String, p: Payment): String =
        p.ref?.let { "ref:" + it.uppercase() } ?: "$pkg:${p.amountCentavos}:${(p.sender ?: "").lowercase()}"

    fun decide(
        pkg: String,
        title: String?,
        text: String?,
        now: Long,
        trusted: Set<String>,
        recent: List<Recent>,
        selfPkg: String = "ph.kwaderno.payalert",
    ): Decision {
        if (pkg == selfPkg) return Decision.Ignore
        val p = PaymentParser.parse(title, text) ?: return Decision.Ignore
        val key = trustKey(pkg, title)
        if (key !in trusted) return Decision.Suggest(p, key)
        val dk = dedupKey(pkg, p)
        if (recent.any { it.dedupKey == dk && now - it.at in 0..DUP_WINDOW_MS }) return Decision.Duplicate
        return Decision.Accept(p, key, dk)
    }

    /** Does a payment match the amount the cashier is waiting for? */
    fun matches(expectedCentavos: Long, p: Payment) = expectedCentavos > 0 && p.amountCentavos == expectedCentavos
}
