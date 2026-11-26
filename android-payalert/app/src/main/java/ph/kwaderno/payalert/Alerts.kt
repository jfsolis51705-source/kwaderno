package ph.kwaderno.payalert

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.provider.Settings
import android.speech.tts.TextToSpeech
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import ph.kwaderno.payalert.core.PaymentParser
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** The "✅ Payment received" pop-up, sound, vibration, voice and notification. */
object Alerts {
    private const val CHANNEL = "payments"
    private val main = Handler(Looper.getMainLooper())
    private var shown: View? = null
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var pendingSay: String? = null

    fun ensureChannel(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) != null) return
        val ch = NotificationChannel(CHANNEL, "Payments received", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Pop-up when a GCash, Maya or bank payment arrives"
            enableVibration(true)
            setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
                AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
        }
        nm.createNotificationChannel(ch)
    }

    fun canPopUp(ctx: Context) = Settings.canDrawOverlays(ctx)

    /** Everything for one payment. Safe to call from the listener service. */
    fun show(ctx: Context, r: Received, more: Int = 0) {
        val app = ctx.applicationContext
        val store = Store(app)
        notify(app, r)
        main.post {
            if (store.popupOn && canPopUp(app)) popup(app, r, more)
            buzz(app)
            if (store.voiceOn) say(app, speech(r))
        }
    }

    fun title(r: Received) = "Payment received " + PaymentParser.peso(r.amountCentavos)

    fun detail(r: Received): String = listOfNotNull(
        r.sender?.let { "from $it" },
        listOfNotNull(r.channel, r.app.takeIf { it.isNotBlank() && it != r.channel }).distinct().joinToString(" · ").ifBlank { null },
        r.ref?.let { "Ref $it" },
        SimpleDateFormat("h:mm a", Locale.US).format(Date(r.at)),
    ).joinToString("  •  ")

    fun speech(r: Received): String {
        val whole = r.amountCentavos / 100
        val cents = r.amountCentavos % 100
        val amount = if (cents == 0L) "$whole pesos" else "$whole pesos and $cents centavos"
        val from = r.sender?.takeIf { it.none { c -> c == '*' } }?.let { ", from $it" } ?: ""
        val via = r.channel?.let { " via $it" } ?: ""
        return "Payment received. $amount$via$from." + if (r.matched) " It matches the bill." else ""
    }

    private fun notify(ctx: Context, r: Received) {
        ensureChannel(ctx)
        val open = PendingIntent.getActivity(ctx, 0, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = Notification.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_launcher)
            .setContentTitle("✅ " + title(r) + if (r.matched) " — matches the bill" else "")
            .setContentText(detail(r))
            .setStyle(Notification.BigTextStyle().bigText(detail(r) + "\nCheck it in the app before handing over the goods."))
            .setCategory(Notification.CATEGORY_STATUS)
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        try { ctx.getSystemService(NotificationManager::class.java).notify(r.id.hashCode(), n) } catch (e: SecurityException) { /* notifications off */ }
    }

    private fun buzz(ctx: Context) {
        try {
            val v = ctx.getSystemService(Vibrator::class.java) ?: return
            v.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 120, 80, 220), -1))
        } catch (e: Exception) { /* no vibrator */ }
    }

    fun say(ctx: Context, text: String) {
        val t = tts
        if (t != null && ttsReady) { t.speak(text, TextToSpeech.QUEUE_FLUSH, null, "pay"); return }
        pendingSay = text
        if (t != null) return
        tts = TextToSpeech(ctx.applicationContext) { status ->
            ttsReady = status == TextToSpeech.SUCCESS
            if (ttsReady) {
                tts?.language = Locale.UK // calm British English, like KWADERNO's assistant voice
                // prefer a male voice when the phone has one
                try { tts?.voices?.firstOrNull { it.locale.language == "en" && it.name.contains("male", true) && !it.name.contains("female", true) }?.let { tts?.voice = it } } catch (e: Exception) { }
                tts?.setSpeechRate(0.95f); tts?.setPitch(0.9f)
                pendingSay?.let { tts?.speak(it, TextToSpeech.QUEUE_FLUSH, null, "pay") }
            }
            pendingSay = null
        }
    }

    /** Full-screen card over whatever app is open (needs "Display over other apps"). */
    private fun popup(ctx: Context, r: Received, more: Int) {
        val wm = ctx.getSystemService(WindowManager::class.java)
        shown?.let { try { wm.removeView(it) } catch (e: Exception) { } }
        val dp = ctx.resources.displayMetrics.density
        fun px(v: Int) = (v * dp).toInt()

        val green = Color.parseColor("#15803D")
        val card = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(px(24), px(24), px(24), px(20))
            background = GradientDrawable().apply { setColor(Color.WHITE); cornerRadius = px(22).toFloat() }
            elevation = px(12).toFloat()
        }
        fun text(s: String, size: Float, color: Int, bold: Boolean = false, top: Int = 0) = TextView(ctx).apply {
            this.text = s; textSize = size; setTextColor(color); gravity = Gravity.CENTER
            if (bold) typeface = Typeface.DEFAULT_BOLD
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = px(top) }
        }
        card.addView(text("✅", 54f, green))
        card.addView(text("Payment received", 20f, Color.parseColor("#14532D"), bold = true, top = 4))
        card.addView(text(PaymentParser.peso(r.amountCentavos), 44f, green, bold = true, top = 2))
        card.addView(text(detail(r), 15f, Color.parseColor("#334155"), top = 6))
        val store = Store(ctx)
        if (store.expected > 0) {
            card.addView(text(
                if (r.matched) "✔ Matches the bill (${PaymentParser.peso(store.expected)})" else "⚠ Bill is ${PaymentParser.peso(store.expected)} — amount is different",
                16f, if (r.matched) green else Color.parseColor("#B45309"), bold = true, top = 10))
        }
        if (more > 0) card.addView(text("+$more more payment(s) — see the app", 14f, Color.parseColor("#64748B"), top = 6))
        card.addView(text("Read from the ${r.app.ifBlank { "payment" }} notification. Check it before handing over the goods.", 12.5f, Color.parseColor("#64748B"), top = 10))
        val ok = Button(ctx).apply {
            text = "OK"; textSize = 18f; setTextColor(Color.WHITE); isAllCaps = false
            background = GradientDrawable().apply { setColor(green); cornerRadius = px(14).toFloat() }
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, px(56)).apply { topMargin = px(16) }
        }
        card.addView(ok)

        val root = LinearLayout(ctx).apply {
            gravity = Gravity.CENTER
            setPadding(px(20), px(20), px(20), px(20))
            setBackgroundColor(Color.parseColor("#99000000"))
            addView(card, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        }
        val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON,
            PixelFormat.TRANSLUCENT,
        )
        val close = Runnable { try { wm.removeView(root) } catch (e: Exception) { }; if (shown === root) shown = null; tts?.stop() }
        ok.setOnClickListener { main.removeCallbacks(close); close.run() }
        try { wm.addView(root, lp); shown = root; main.postDelayed(close, 90_000) } catch (e: Exception) { /* permission was turned off */ }
    }

    fun testPayment(ctx: Context): Received {
        val store = Store(ctx)
        val amount = if (store.expected > 0) store.expected else 25000L
        return Received("test-" + System.currentTimeMillis(), System.currentTimeMillis(), "test", "GCash", amount, "JU***N C.", "TEST123456", "GCash", store.expected > 0, "test")
    }
}
