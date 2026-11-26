# Backlog: what's missing, to add later

Last updated: 26 Nov 2026. Each item says **who it's waiting on**:

- **Owner**: a step only the owner can do (an account, a setting, a screenshot)
- **Build**: work for the developer
- **Hosting**: needs Retail Intelligence online first

Where things live:

| Branch | What |
|---|---|
| `demo-link-app` | KWADERNO store app + Super Admin (claude.ai artifact, v53) |
| `retail-intel` | Retail Intelligence (FastAPI + React), not hosted yet |
| `scanner-pwa` / `gh-pages` | QR & barcode scanner web app |
| `pay-alert` | Android payment-alert app (pilot) |

---

## 0. Owner to-do (blocks other items)

- [ ] **Turn on GitHub Pages** for the scanner. Go to Settings → Pages → Deploy from a branch → `gh-pages` / root. The app will be at `https://<owner>.github.io/kwaderno/`.
- [ ] **Create a hosting account** for Retail Intelligence (Render suggested). This unlocks every "Hosting" item below.
- [ ] **Send real payment notifications**: a screenshot each of GCash, Maya and your banks' "money received" message, names and account numbers covered. Also list which banks the stores use.
- [ ] **Send screenshots of the logbook scanner and barcode/QR scanner failing** inside KWADERNO. The logbook's red message ends with a code like `@ worker` that names the cause.
- [ ] **Install the Pay Alert pilot app** on 1–2 test phones and report what happens.
- [ ] Later: a **Google Play developer account** (one-time fee), for publishing Pay Alert.
- [ ] Later: a **payment provider merchant account** (e.g. PayMongo or Xendit), for payments the provider itself confirms.

## 1. Barcode & QR scanner (priority)

- [ ] **Test on real phones** (Build + Owner): iPhone Safari, the installed iPhone app, Android Chrome, one cheap Android, and a desktop webcam. Check that the flashlight and lens picker work.
- [ ] **Connect the scanner to KWADERNO** (Build):
  - a scan adds the item to the current sale or to stock-in;
  - an unknown code opens "Add product" with the code filled in;
  - inside claude.ai the camera is blocked, so the link out to the scanner returns the code.
  - Note: the Retail Intelligence app already has a live auto-scanner; it only needs hosting.
- [ ] **Stock-count mode** (Build): scan many items, see a count per code, export.
- [ ] **Product lookup** (Build): show the product name for a scanned barcode, from the store's own products first, then Open Food Facts.
- [ ] **Saved / starred scans and a Search tab**, as in the design pictures (Build).
- [ ] **Remove the outdated `landacts` test** in KWADERNO. It checks title-bar buttons the owner asked to remove (Build).

## 2. Payment alerts

- [ ] **Fit the reader to real notification wording** once the screenshots arrive, and add each one as a test (Build, after Owner).
- [ ] **Try Pay Alert on a real Android phone** (Owner + Build):
  - the overlay pop-up and the notification-access steps;
  - phone brands that kill background apps (Xiaomi, Oppo, Vivo battery settings).
- [ ] **"Paste or share the notification" into KWADERNO** (Build). Works on iPhone and desktop:
  - read amount, reference and sender;
  - match to the open bill;
  - show the "Payment received" pop-up, marked *owner-verified*.
- [ ] **Send payments from the phone to the desktop POS** so the pop-up shows there too (Hosting).
- [ ] **Tagalog voice option** in Pay Alert (Build).
- [ ] **Google Play release** (Build, after Owner): release signing key, privacy policy page, and Google's notification-access form.
- [ ] **Payment provider QR** (Build, after Owner): the provider confirms each payment, with no notification reading needed.

Rule that stays: never say "verified by GCash/Maya". Notifications are *matched, owner-verified*. Only a provider confirmation counts as confirmed.

## 3. KWADERNO store app + Super Admin

- [ ] **Fix the logbook scanner** (photo → stock-in or sales) once its error screenshot arrives (Build, after Owner).
- [ ] **Chat support: AI agent + human** (Build):
  - the store first gets built-in answers (no AI on the store's phone);
  - unanswered questions go to a Super Admin inbox, where an AI drafts the reply;
  - a person approves it or takes over;
  - customer names stay hidden.
- [ ] **Supplier orders, more** (Build):
  - orders sent by a merchant's branches;
  - partial delivery (some items short);
  - delivery fee and an invoice/receipt for the store;
  - an order message to the supplier by SMS or Messenger.
- [ ] **New-order alerts when the admin isn't looking at the admin screen**, by email or phone push (Hosting).
- [ ] **Claude's voice** only works on claude.ai in a browser. The Claude app and Safari use the phone's voice, and nothing more can be done there.

## 4. Retail Intelligence (web portal)

- [ ] **Go online** (Hosting, after Owner). This turns on live camera auto-scan, share links and the installable app for real phones.
- [ ] **Keep store data on the device**, as KWADERNO does, so the company only receives summaries (Build). This is a bigger redesign; confirm before starting.
- [ ] **Faster portal Overview at 1,000+ stores** (Build). It takes about 2 s today.
- [ ] **Voice:** use the device's voices, calm male by default. A paid text-to-speech service is optional. Claude's voice can't be used outside claude.ai.

## 5. Done this round (for reference)

- Claude's voice in KWADERNO, with voice picker and fallback to the phone's voice.
- Alerts before expiry (30/14/7/3/1 days before, on the day, and once expired).
- Supplier orders → Super Admin pop-up with voice; Accept / Out for delivery / Decline; order detail page; "Super Admin view" button on the store's order.
- Grocery store type.
- Live scanner in KWADERNO reads barcodes held close.
- QR & barcode scanner web app (`scanner-pwa`). It passes 21 browser tests, including a small, far barcode read in about 0.4 s and your 555 can photo.
- Android Pay Alert pilot app (29 unit tests; not yet tried on a real phone).
