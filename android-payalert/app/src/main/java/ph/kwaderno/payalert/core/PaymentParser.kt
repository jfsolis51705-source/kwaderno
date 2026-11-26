package ph.kwaderno.payalert.core

/**
 * Reads a "money received" notification from GCash, Maya, a bank app or a bank SMS.
 *
 * Plain Kotlin (no Android code) so it can be unit-tested. It only reads text; whether the
 * notification can be trusted is decided by [PayLogic] from the app that posted it.
 */
data class Payment(
    /** Amount in centavos (₱250.00 = 25000). */
    val amountCentavos: Long,
    /** Who paid, as the notification shows it (GCash already masks it, e.g. "JU***N DE*A C."). */
    val sender: String?,
    /** Reference / trace number, if the notification has one. */
    val ref: String?,
    /** GCash, Maya, InstaPay, PESONet, QR Ph … when the text names it. */
    val channel: String?,
)

object PaymentParser {
    private const val NUM = """(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)"""

    /** ₱250, PHP 250.00, Php1,250.50, P250.00 (a lone "P" only right before the digits). */
    private val AMOUNT = Regex("""(?:₱|\bPHP\b|\bPhp\b|\bphp\b|(?<![A-Za-z])P(?=\s?\d))\s?$NUM""")

    /** Words that mean money came IN to this account. */
    private val INCOMING = Regex(
        """\b(received|receive|you got|credited|has been credited|deposited|deposit received|sent you|paid you|payment received|""" +
            """incoming|natanggap|nakatanggap|fund transfer received|transfer received|money in|collected)\b""",
        RegexOption.IGNORE_CASE,
    )

    /** Words that mean money went OUT, or is not a customer payment. */
    private val OUTGOING = Regex(
        """\b(you sent|you have sent|you've sent|you paid|you have paid|paid to|payment to|sent to|transferred to|you transferred|""" +
            """debited|withdrawn|withdrawal|purchase|bills payment|buy load|bought|cash out|cash-out|deducted|charged|""" +
            """request(ed)? money|requesting|due|failed|reversed|refund(ed)? to|pending)\b""",
        RegexOption.IGNORE_CASE,
    )

    /** The owner moving their own money in is not a sale. */
    private val OWN_TOPUP = Regex("""\b(cash in|cash-in|cashed in|top ?up|topped up)\b""", RegexOption.IGNORE_CASE)

    /** An amount right after these words is a balance, fee or limit, not the payment. */
    private val NOT_PAYMENT_BEFORE = Regex(
        """(balance|bal\.?|available|avail\.?|fee|charge|limit|minimum|max(imum)?|wallet size|new bal)\s*(is|of|:)?\s*$""",
        RegexOption.IGNORE_CASE,
    )

    private val REF = Regex(
        """(?:\bRef(?:erence)?\.?\s*(?:No\.?|Number|Num\.?|#|ID)?|\bTrace\s*(?:No\.?|Number)|\bTransaction\s*(?:ID|No\.?|Number)|\bTxn\s*(?:ID|No\.?))""" +
            """\s*[:#.]?\s*(\d{3,}(?: \d{3,}){1,4}(?![A-Z0-9])|[A-Z0-9][A-Z0-9-]{5,29})""",
        RegexOption.IGNORE_CASE,
    )

    private val SENDER_FROM = Regex(
        """\b(?:from|mula (?:kay|sa))\s+(?:account\s+)?(.{2,60}?)(?=\s+(?:on|via|thru|through|using|with|to|at|in|for|ref|reference|trace|your|has|is|was)\b|[.,;!(\n]|\s+\d{4}|$)""",
        RegexOption.IGNORE_CASE,
    )
    private val SENDER_SENT_YOU = Regex("""^\s*(.{2,60}?)\s+(?:sent you|paid you|has sent you|transferred)\b""", setOf(RegexOption.IGNORE_CASE, RegexOption.MULTILINE))

    private val CHANNELS = listOf(
        "QR Ph" to Regex("""\bQR\s?Ph\b""", RegexOption.IGNORE_CASE),
        "InstaPay" to Regex("""\binsta\s?pay\b""", RegexOption.IGNORE_CASE),
        "PESONet" to Regex("""\bpeso\s?net\b""", RegexOption.IGNORE_CASE),
        "GCash" to Regex("""\bg\s?cash\b""", RegexOption.IGNORE_CASE),
        "Maya" to Regex("""\b(maya|paymaya)\b""", RegexOption.IGNORE_CASE),
    )

    /** Returns the payment if the text says money was received, else null. */
    fun parse(title: String?, text: String?): Payment? {
        val body = listOfNotNull(title, text).joinToString(" \n ") { clean(it) }.trim()
        if (body.isEmpty()) return null
        if (!INCOMING.containsMatchIn(body)) return null
        if (OWN_TOPUP.containsMatchIn(body)) return null
        // "You sent ₱100 … You received a cashback" etc.: an outgoing word before the first incoming word means it's not a customer payment
        val out = OUTGOING.find(body)
        val inc = INCOMING.find(body)!!
        if (out != null && out.range.first < inc.range.first) return null
        if (out != null && Regex("""\b(failed|reversed|pending)\b""", RegexOption.IGNORE_CASE).containsMatchIn(body)) return null

        val amount = pickAmount(body) ?: return null
        if (amount <= 0) return null
        return Payment(amount, sender(body), ref(body), CHANNELS.firstOrNull { it.second.containsMatchIn(body) }?.first)
    }

    /** First amount that isn't a balance/fee/limit. */
    private fun pickAmount(body: String): Long? {
        for (m in AMOUNT.findAll(body)) {
            val before = body.substring(maxOf(0, m.range.first - 30), m.range.first)
            if (NOT_PAYMENT_BEFORE.containsMatchIn(before)) continue
            return toCentavos(m.groupValues[1])
        }
        return null
    }

    fun toCentavos(s: String): Long? {
        val t = s.replace(",", "")
        val parts = t.split(".")
        val whole = parts[0].toLongOrNull() ?: return null
        val cents = when {
            parts.size < 2 -> 0L
            parts[1].length == 1 -> parts[1].toLong() * 10
            else -> parts[1].take(2).toLong()
        }
        return whole * 100 + cents
    }

    private fun ref(body: String): String? =
        REF.findAll(body).map { it.groupValues[1].replace(" ", "").trimEnd('-', '.') }.firstOrNull { r -> r.count { it.isDigit() } >= 4 }

    private fun sender(body: String): String? {
        val raw = SENDER_FROM.find(body)?.groupValues?.get(1) ?: SENDER_SENT_YOU.find(body)?.groupValues?.get(1) ?: return null
        val s = raw.trim().trimEnd('.', ',', ':').replace(Regex("""\s+"""), " ")
        // "from your account", "from GCash", amounts — not a person
        if (s.isEmpty() || Regex("""^(your|my|the|gcash|maya|paymaya|bank|account)\b""", RegexOption.IGNORE_CASE).containsMatchIn(s)) return null
        if (AMOUNT.containsMatchIn(s) || s.count { it.isDigit() } > s.length / 2) return null
        return s.take(40)
    }

    private fun clean(s: String) = s.replace(' ', ' ').replace(' ', ' ').replace(Regex("""[ \t]+"""), " ")

    /** ₱1,250.50 */
    fun peso(centavos: Long): String {
        val whole = centavos / 100
        val cents = (centavos % 100).toString().padStart(2, '0')
        return "₱" + whole.toString().reversed().chunked(3).joinToString(",").reversed() + "." + cents
    }
}
