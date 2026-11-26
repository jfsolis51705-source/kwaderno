package ph.kwaderno.payalert.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PayLogicTest {
    private val gcash = "com.globe.gcash.android"
    private val sms = "com.google.android.apps.messaging"
    private val text = "You have received PHP 250.00 of GCash from JU***N C. Ref. No. 1234567890123."

    @Test fun trustedAppPopsUp() {
        val d = PayLogic.decide(gcash, "GCash", text, 1_000, setOf(gcash), emptyList())
        assertTrue(d is PayLogic.Decision.Accept)
        assertEquals(25000L, (d as PayLogic.Decision.Accept).payment.amountCentavos)
    }

    @Test fun untrustedAppOnlySuggests() {
        val d = PayLogic.decide("com.some.fake", "GCash", text, 1_000, setOf(gcash), emptyList())
        assertTrue(d is PayLogic.Decision.Suggest)
        assertEquals("com.some.fake", (d as PayLogic.Decision.Suggest).trustKey)
    }

    @Test fun smsTrustIsPerSender() {
        val bank = "Your account has been credited with PHP 500.00 via InstaPay from ANA R. Ref No. 99887766"
        val trusted = setOf("$sms|bdo")
        assertTrue(PayLogic.decide(sms, "BDO", bank, 1, trusted, emptyList()) is PayLogic.Decision.Accept)
        // same text from an unknown number must not pop up
        assertTrue(PayLogic.decide(sms, "+639171234567", bank, 1, trusted, emptyList()) is PayLogic.Decision.Suggest)
    }

    @Test fun sameRefOnceOnly() {
        val first = PayLogic.decide(gcash, "GCash", text, 1_000, setOf(gcash), emptyList()) as PayLogic.Decision.Accept
        val again = PayLogic.decide(gcash, "GCash", text, 60_000, setOf(gcash), listOf(PayLogic.Recent(first.dedupKey, 1_000)))
        assertEquals(PayLogic.Decision.Duplicate, again)
        // a different payment of the same amount (different ref) still pops up
        val other = PayLogic.decide(gcash, "GCash", text.replace("1234567890123", "9999999999999"), 60_000, setOf(gcash), listOf(PayLogic.Recent(first.dedupKey, 1_000)))
        assertTrue(other is PayLogic.Decision.Accept)
    }

    @Test fun noRefSameAmountAfterWindowCountsAgain() {
        val t = "Pedro sent you ₱500.00"
        val a = PayLogic.decide("com.paymaya", "Maya", t, 0, setOf("com.paymaya"), emptyList()) as PayLogic.Decision.Accept
        val b = PayLogic.decide("com.paymaya", "Maya", t, PayLogic.DUP_WINDOW_MS + 1, setOf("com.paymaya"), listOf(PayLogic.Recent(a.dedupKey, 0)))
        assertTrue(b is PayLogic.Decision.Accept)
    }

    @Test fun outgoingIgnored() {
        assertEquals(PayLogic.Decision.Ignore, PayLogic.decide(gcash, "GCash", "You have sent PHP 50.00 to X. Ref 12345678", 1, setOf(gcash), emptyList()))
    }

    @Test fun ownNotificationsIgnored() {
        assertEquals(PayLogic.Decision.Ignore, PayLogic.decide("ph.kwaderno.payalert", "Payment received", text, 1, setOf("ph.kwaderno.payalert"), emptyList()))
    }

    @Test fun paymentAppNames() {
        assertTrue(PayLogic.looksLikePaymentApp("GCash"))
        assertTrue(PayLogic.looksLikePaymentApp("BDO Digital Banking"))
        assertTrue(PayLogic.looksLikePaymentApp("Maya – savings, loans, cards"))
        assertFalse(PayLogic.looksLikePaymentApp("Facebook"))
        assertFalse(PayLogic.looksLikePaymentApp("Calculator"))
    }

    @Test fun amountMatch() {
        val p = Payment(25000, null, null, null)
        assertTrue(PayLogic.matches(25000, p))
        assertFalse(PayLogic.matches(26000, p))
        assertFalse(PayLogic.matches(0, p))
    }
}
