package ph.kwaderno.payalert.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Sample texts written in the style of PH wallet and bank notifications.
 * Replace / add real ones (names and numbers covered) as the pilot stores send them.
 */
class PaymentParserTest {
    private fun p(title: String?, text: String) = PaymentParser.parse(title, text)

    @Test fun gcashReceived() {
        val r = p("GCash", "You have received PHP 250.00 of GCash from JU***N DE*A C. Your new balance is PHP 1,234.56. Ref. No. 1234 567 890123.")!!
        assertEquals(25000L, r.amountCentavos)
        assertEquals("JU***N DE*A C", r.sender)
        assertEquals("GCash", r.channel)
        assertEquals("1234567890123", r.ref)
    }

    @Test fun gcashPesoSign() {
        val r = p("Money received", "You received ₱1,250.50 from MA**A S. via GCash. Ref No. 9012345678901")!!
        assertEquals(125050L, r.amountCentavos)
        assertEquals("MA**A S", r.sender)
        assertEquals("9012345678901", r.ref)
    }

    @Test fun mayaReceived() {
        val r = p("Maya", "You received ₱80.00 from Juan Dela Cruz. Ref: 7A3F9C21B0")!!
        assertEquals(8000L, r.amountCentavos)
        assertEquals("Juan Dela Cruz", r.sender)
        assertEquals("7A3F9C21B0", r.ref)
        assertEquals("Maya", r.channel)
    }

    @Test fun nameSentYou() {
        val r = p("Maya", "Pedro Santos sent you ₱500.00")!!
        assertEquals(50000L, r.amountCentavos)
        assertEquals("Pedro Santos", r.sender)
    }

    @Test fun bankInstapayCredit() {
        val r = p("BDO", "Your account ending 1234 has been credited with PHP 1,000.00 via InstaPay from JUAN DELA CRUZ on 26 Nov 2026 10:15 AM. Ref No. 554433221100")!!
        assertEquals(100000L, r.amountCentavos)
        assertEquals("JUAN DELA CRUZ", r.sender)
        assertEquals("InstaPay", r.channel)
        assertEquals("554433221100", r.ref)
    }

    @Test fun qrPh() {
        val r = p("UnionBank", "Payment received! P 350.00 via QR Ph from ANA R. Trace No. 008812345")!!
        assertEquals(35000L, r.amountCentavos)
        assertEquals("QR Ph", r.channel)
        assertEquals("008812345", r.ref)
    }

    @Test fun balanceBeforeAmountIsSkipped() {
        val r = p("Bank", "Available balance: PHP 9,999.00. You received PHP 120.00 from LIZA M.")!!
        assertEquals(12000L, r.amountCentavos)
    }

    @Test fun tagalog() {
        val r = p("GCash", "Nakatanggap ka ng ₱75.00 mula kay RO**O. Ref No. 1122334455")!!
        assertEquals(7500L, r.amountCentavos)
        assertEquals("RO**O", r.sender)
    }

    @Test fun oneDecimal() { assertEquals(2050L, PaymentParser.toCentavos("20.5")) }

    @Test fun pesoFormat() {
        assertEquals("₱1,250.50", PaymentParser.peso(125050))
        assertEquals("₱0.80", PaymentParser.peso(80))
        assertEquals("₱1,000,000.00", PaymentParser.peso(100000000))
    }

    // ---- must NOT count as a customer payment ----
    @Test fun sentOut() { assertNull(p("GCash", "You have sent PHP 500.00 to JU***N C. Your new balance is PHP 734.56. Ref. No. 1234567890")) }
    @Test fun paidMerchant() { assertNull(p("Maya", "You paid ₱120.00 to 7-Eleven. Ref 88776655")) }
    @Test fun debited() { assertNull(p("BPI", "PHP 2,000.00 was debited from your account ending 5678.")) }
    @Test fun ownCashIn() { assertNull(p("GCash", "You have received PHP 1,000.00 via Cash In from 7-Eleven. Ref No. 1234567890")) }
    @Test fun balanceOnly() { assertNull(p("GCash", "Your GCash balance is PHP 1,234.56")) }
    @Test fun requestMoney() { assertNull(p("GCash", "JU***N requested money: ₱300.00. Tap to pay.")) }
    @Test fun failed() { assertNull(p("Maya", "Transfer failed. You received a refund of ₱50.00 pending")) }
    @Test fun noAmount() { assertNull(p("GCash", "You received a voucher!")) }
    @Test fun promo() { assertNull(p("GCash", "Get 50% off when you pay with GCash!")) }

    @Test fun senderNotTakenFromAccountWords() {
        val r = p("Bank", "You received PHP 300.00 from your savings account. Ref 123456789")!!
        assertNull(r.sender)
        assertTrue(r.amountCentavos == 30000L)
    }
}
