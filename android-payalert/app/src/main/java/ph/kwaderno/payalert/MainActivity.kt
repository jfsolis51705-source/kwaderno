package ph.kwaderno.payalert

import android.Manifest
import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast
import ph.kwaderno.payalert.core.PayLogic
import ph.kwaderno.payalert.core.PaymentParser
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/** Setup checklist, the amount the cashier is waiting for, today's payments, and which apps to trust. */
class MainActivity : Activity() {
    private lateinit var store: Store
    private lateinit var body: LinearLayout
    private var showAllApps = false
    private val teal = Color.parseColor("#0F766E")
    private val green = Color.parseColor("#15803D")
    private val muted = Color.parseColor("#64748B")
    private val ink = Color.parseColor("#0F172A")
    private val listener = SharedPreferences.OnSharedPreferenceChangeListener { _, _ -> runOnUiThread { render() } }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = Store(this)
        Alerts.ensureChannel(this)
        body = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(18), dp(18), dp(18), dp(40)) }
        setContentView(ScrollView(this).apply { setBackgroundColor(Color.parseColor("#F1F5F9")); addView(body) })
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
    }

    override fun onResume() { super.onResume(); store.prefs.registerOnSharedPreferenceChangeListener(listener); render() }
    override fun onPause() { store.prefs.unregisterOnSharedPreferenceChangeListener(listener); super.onPause() }

    private fun listenerOn(): Boolean {
        val flat = Settings.Secure.getString(contentResolver, "enabled_notification_listeners") ?: return false
        val me = ComponentName(this, PayListenerService::class.java)
        return flat.split(":").any { ComponentName.unflattenFromString(it) == me }
    }

    private fun notifOn() = Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private fun render() {
        body.removeAllViews()
        body.addView(text("KWADERNO Pay Alert", 24f, ink, bold = true))
        body.addView(text("Pops up when a GCash, Maya or bank payment arrives on this phone.", 15f, muted, top = 4))

        // 1. setup
        val ready = listenerOn() && Alerts.canPopUp(this) && notifOn() && store.trusted.isNotEmpty()
        body.addView(card(
            text(if (ready) "✅ Ready — payments will pop up" else "Set up (one time)", 18f, if (ready) green else ink, bold = true),
            step("1. Read payment notifications", listenerOn(), "Turn on") {
                toast("Find \"KWADERNO Pay Alert\" and switch it on")
                startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
            },
            step("2. Pop up over other apps", Alerts.canPopUp(this), "Turn on") {
                startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
            },
            step("3. Allow notifications", notifOn(), "Allow") {
                if (Build.VERSION.SDK_INT >= 33) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
            },
            step("4. Tick your payment apps below", store.trusted.isNotEmpty(), null) {},
        ))

        // 2. waiting for a bill
        val amt = EditText(this).apply {
            hint = "Bill amount, e.g. 250"; inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL; textSize = 20f
            if (store.expected > 0) setText((store.expected / 100.0).toString().removeSuffix(".0"))
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        val setBtn = button("Set", teal) {
            val c = PaymentParser.toCentavos(amt.text.toString().trim().replace("₱", ""))
            if (c == null || c <= 0) toast("Type the bill amount") else { store.expected = c; toast("Waiting for " + PaymentParser.peso(c)) }
        }
        body.addView(card(
            text("Waiting for a payment?", 17f, ink, bold = true),
            text(if (store.expected > 0) "Waiting for ${PaymentParser.peso(store.expected)} — the pop-up will say if it matches." else "Type the bill so the pop-up can tell you if the amount matches.", 14f, muted, top = 2),
            row(amt, setBtn, if (store.expected > 0) button("Clear", Color.parseColor("#94A3B8")) { store.expected = 0 } else null),
        ))

        // 3. today's payments
        val start = Calendar.getInstance().apply { set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0) }.timeInMillis
        val today = store.payments.filter { it.at >= start && it.pkg != "test" }.reversed()
        val list = mutableListOf<View>(
            text("Today: " + PaymentParser.peso(today.sumOf { it.amountCentavos }) + " · ${today.size} payment(s)", 17f, ink, bold = true),
        )
        if (today.isEmpty()) list += text("None yet.", 14f, muted, top = 4)
        for (r in today.take(30)) list += LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(0, dp(8), 0, dp(8))
            addView(text(PaymentParser.peso(r.amountCentavos) + if (r.matched) "   ✔ matched bill" else "", 17f, if (r.matched) green else ink, bold = true))
            addView(text(Alerts.detail(r), 13f, muted))
        }
        body.addView(card(*list.toTypedArray()))

        // 4. suggestions from apps not trusted yet
        val sug = store.suggestions.reversed()
        if (sug.isNotEmpty()) body.addView(card(
            text("Is this your payment app?", 17f, ink, bold = true),
            text("These said money came in, but you haven't trusted them, so they didn't pop up.", 13f, muted, top = 2),
            *sug.take(6).map { s ->
                LinearLayout(this).apply {
                    orientation = LinearLayout.VERTICAL; setPadding(0, dp(10), 0, dp(4))
                    addView(text(s.app + (s.sender?.let { " — sender \"$it\"" } ?: ""), 15f, ink, bold = true))
                    addView(text(s.sample, 13f, muted))
                    addView(row(
                        button("Trust", teal) { store.trust(s.trustKey, true); toast("Trusted") },
                        button("Not mine", Color.parseColor("#94A3B8")) { store.suggestions = store.suggestions.filter { it.trustKey != s.trustKey } },
                    ))
                    if (PayLogic.isSmsApp(s.pkg)) addView(text("Text messages: trust only your bank's sender name, never a phone number.", 12f, Color.parseColor("#B45309")))
                }
            }.toTypedArray(),
        ))

        // 5. apps to trust
        val launcher = packageManager.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0)
            .map { it.activityInfo.packageName to it.loadLabel(packageManager).toString() }.distinctBy { it.first }
            .filter { it.first != packageName }.sortedBy { it.second.lowercase() }
        val payApps = launcher.filter { PayLogic.looksLikePaymentApp(it.second) || it.first in store.trusted }
        val shown = if (showAllApps) launcher else payApps
        val apps = mutableListOf<View>(
            text("Payment apps to watch", 17f, ink, bold = true),
            text("Only ticked apps can make the pop-up appear. Other notifications are ignored and never saved.", 13f, muted, top = 2),
        )
        if (shown.isEmpty()) apps += text("No GCash, Maya or bank app found. Tap \"Show all apps\".", 14f, muted, top = 6)
        for ((pkg, label) in shown) apps += CheckBox(this).apply {
            text = label; textSize = 16f; isChecked = pkg in store.trusted
            setOnCheckedChangeListener { _, on -> store.trust(pkg, on) }
        }
        apps += button(if (showAllApps) "Show payment apps only" else "Show all apps", Color.parseColor("#475569")) { showAllApps = !showAllApps; render() }
        val smsTrusted = store.trusted.filter { it.contains("|") }
        if (smsTrusted.isNotEmpty()) apps += text("Trusted SMS senders: " + smsTrusted.joinToString { it.substringAfter("|").uppercase() }, 13f, muted, top = 6)
        body.addView(card(*apps.toTypedArray()))

        // 6. settings
        body.addView(card(
            text("Alert", 17f, ink, bold = true),
            switch("Pop-up on screen", store.popupOn) { store.popupOn = it },
            switch("Say it out loud", store.voiceOn) { store.voiceOn = it },
            row(
                button("Test pop-up", teal) {
                    if (!Alerts.canPopUp(this)) toast("Turn on step 2 first") else Alerts.show(this, Alerts.testPayment(this))
                },
                button("Clear history", Color.parseColor("#94A3B8")) { store.clearPayments() },
            ),
        ))
        body.addView(text("Privacy: payments are kept only on this phone. A notification is not proof of payment — check before handing over the goods.", 12.5f, muted, top = 8))
    }

    // ---------- small view helpers ----------
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun text(s: String, size: Float, color: Int, bold: Boolean = false, top: Int = 0) = TextView(this).apply {
        text = s; textSize = size; setTextColor(color); if (bold) typeface = Typeface.DEFAULT_BOLD
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(top) }
    }

    private fun card(vararg kids: View) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(14), dp(16), dp(14))
        background = GradientDrawable().apply { setColor(Color.WHITE); cornerRadius = dp(16).toFloat() }
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(14) }
        kids.forEach { addView(it) }
    }

    private fun button(label: String, color: Int, onClick: () -> Unit) = Button(this).apply {
        text = label; isAllCaps = false; textSize = 15f; setTextColor(Color.WHITE)
        background = GradientDrawable().apply { setColor(color); cornerRadius = dp(12).toFloat() }
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(46)).apply { topMargin = dp(8); marginStart = dp(6) }
        setPadding(dp(16), 0, dp(16), 0)
        setOnClickListener { onClick() }
    }

    private fun row(vararg kids: View?) = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        kids.filterNotNull().forEach { addView(it) }
    }

    private fun step(label: String, done: Boolean, action: String?, onClick: () -> Unit) = row(
        text((if (done) "✅  " else "⬜  ") + label, 15f, if (done) green else ink).apply { layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f) },
        if (!done && action != null) button(action, teal, onClick) else null,
    ).apply { setPadding(0, dp(6), 0, 0) }

    private fun switch(label: String, on: Boolean, change: (Boolean) -> Unit) = Switch(this).apply {
        text = label; textSize = 15f; isChecked = on; setPadding(0, dp(8), 0, dp(8))
        setOnCheckedChangeListener { _, v -> change(v) }
    }

    private fun toast(s: String) = Toast.makeText(this, s, Toast.LENGTH_LONG).show()

    @Suppress("unused") private fun fmt(t: Long) = SimpleDateFormat("h:mm a", Locale.US).format(Date(t))
}
