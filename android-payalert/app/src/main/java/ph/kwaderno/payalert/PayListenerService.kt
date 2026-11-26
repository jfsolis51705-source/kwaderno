package ph.kwaderno.payalert

import android.app.Notification
import android.content.pm.PackageManager
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import ph.kwaderno.payalert.core.PayLogic
import java.util.UUID

/**
 * Android starts this only after the owner turns on Notification access for KWADERNO Pay Alert.
 * It looks at each new notification, and only notifications that say money came in matter:
 * from a trusted app → pop-up; from any other app → a suggestion in the app ("Is this your bank app?").
 * Nothing is uploaded; chats and other notifications are dropped right away.
 */
class PayListenerService : NotificationListenerService() {

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        try { handle(sbn) } catch (e: Exception) { /* never crash the listener */ }
    }

    private fun handle(sbn: StatusBarNotification) {
        val n = sbn.notification ?: return
        if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return // the "3 new messages" summary repeats the real ones
        val ex = n.extras ?: return
        val title = ex.getCharSequence(Notification.EXTRA_TITLE)?.toString()
        val text = (ex.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: ex.getCharSequence(Notification.EXTRA_TEXT))?.toString()
        if (title.isNullOrBlank() && text.isNullOrBlank()) return

        val store = Store(this)
        val now = System.currentTimeMillis()
        when (val d = PayLogic.decide(sbn.packageName, title, text, now, store.trusted, store.recent(), packageName)) {
            is PayLogic.Decision.Accept -> {
                val p = d.payment
                val r = Received(
                    id = UUID.randomUUID().toString(), at = now, pkg = sbn.packageName, app = appLabel(sbn.packageName, title),
                    amountCentavos = p.amountCentavos, sender = p.sender, ref = p.ref, channel = p.channel,
                    matched = PayLogic.matches(store.expected, p), dedupKey = d.dedupKey,
                )
                store.addPayment(r)
                if (r.matched) store.expected = 0 // the bill is paid; ready for the next one
                Alerts.show(this, r)
            }
            is PayLogic.Decision.Suggest ->
                store.addSuggestion(d.trustKey, sbn.packageName, appLabel(sbn.packageName, null), if (PayLogic.isSmsApp(sbn.packageName)) title else null,
                    d.payment, listOfNotNull(title, text).joinToString(" — "), now)
            else -> Unit
        }
    }

    private fun appLabel(pkg: String, smsSender: String?): String {
        val label = try { packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString() } catch (e: PackageManager.NameNotFoundException) { pkg }
        return if (PayLogic.isSmsApp(pkg) && !smsSender.isNullOrBlank()) "$smsSender (SMS)" else label
    }
}
