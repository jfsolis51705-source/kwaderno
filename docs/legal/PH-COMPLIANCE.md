# KWADERNO — Philippine legal compliance plan

Living document. A weekly automated check adds new laws, rules and bills under "Weekly log" and adjusts the plan.
Not legal advice: every item here needs review by a Philippine lawyer before launch.

Last full review: 2026-11-28

## How KWADERNO handles data (what the law applies to)
- Store data (each sale, customers, utang names and numbers) stays on the store's phone.
- The store owner chooses what KELSON receives, in levels (Privacy Notice v2026-11-28.2):
  - Always: store name and area, number of products and low-stock items, questions asked to Kwaderno (names removed).
  - Level 1 "Help KWADERNO learn" (opt-in): products, stock counts, units sold, barcodes, shelf photos. No money amounts.
  - Level 2 "Sales summary" (opt-in): daily sales totals, payment mix, stock value, total utang. Never single receipts or customer names.
  - Level 3 "Apply for credit" (consent per application): full sales history, only to a named lender. Today the app only records the application; nothing goes to a lender until a lending pilot opens and the owner confirms again with the lender's name shown.
- Stores that agreed before the levels keep sending totals until they review the new notice (then sales sharing starts unticked).
- Exports leave out areas with fewer than 5 stores. The notice says KWADERNO does not give data to the BIR or other stores and does not sell it, except when the law requires.
- Brands and partners get combined (anonymized) data only, unless a store agrees otherwise.
- Servers may be outside the Philippines (cloud providers); KELSON stays accountable.

## Laws and rules that apply
| Law / rule | Why it matters to KWADERNO | Status | Next step |
|---|---|---|---|
| Data Privacy Act of 2012 (RA 10173) and its Implementing Rules | Store owners' and customers' personal information | In app: bilingual Privacy Notice (draft), required consent, AI-photo opt-in, data download, deletion request, Super Admin compliance card | Lawyer review of the notice; fill in KELSON's legal name and DPO contact |
| National Privacy Commission (NPC) circulars on registration, breach management and consent | Registration thresholds, 72-hour breach notification, valid consent | Breach plan: not written yet. Registration: not yet | Check registration thresholds; write a breach response plan; appoint a Data Protection Officer |
| E-Commerce Act (RA 8792) | Electronic consent and records are valid | Consent is recorded with version and date | Keep consent records |
| Internet Transactions Act of 2023 (RA 11967) | Applies to online business transactions; may apply to supplier orders or any online selling feature | Not assessed | Lawyer: does KWADERNO count as an online merchant, e-marketplace or platform? |
| Philippine Competition Act (RA 10667) | Sharing competitors' sensitive pricing data via market reports | Reports use combined data | Lawyer review of brand data products |
| Cybercrime Prevention Act (RA 10175) | Security of systems and data | Owner-only access to admin data; logins | Security review before scale |
| Consumer Act (RA 7394) | Fair terms for store owners as users | Terms of service not written | Write Terms of Service in Filipino and English |
| Tax rules on digital services (BIR) | If KWADERNO charges subscriptions or sells data | Not assessed | Accountant review before charging |
| Credit Information System Act (RA 9510) and Credit Information Corporation (CIC) rules | Level 3 uses store sales as alternative data for credit scoring; submitting to or using credit bureaus is regulated | Not assessed | Lawyer: is KWADERNO a data source to a lender, a submitting entity, or does it need a CIC-accredited bureau partner? |
| Lending Company Regulation Act (RA 9474) and SEC rules on lending, financing (RA 8556) and online lending platforms | Quick loans for stores must come from an SEC-licensed lender; online lending apps have registration, disclosure and fair debt-collection rules | KWADERNO does not lend; it only records applications | Partner only with an SEC-licensed lender; lawyer: does referring stores or showing loan offers in the app need registration? |
| Financial Products and Services Consumer Protection Act (RA 11765) | Fair treatment and disclosure for store owners who take loans through a partner | Not assessed | Lawyer review of the loan flow and disclosures before the pilot |
| Truth in Lending Act (RA 3765) | Full disclosure of loan cost to the borrower | Lender's duty; app must not hide terms | Show the lender's full disclosure before the owner accepts |
| Pending AI bills in Congress | Possible future AI rules (transparency, data use) | Watching | Weekly check |

## Open actions
- [ ] Lawyer review: Privacy Notice, consent screens, Terms of Service, brand data-sharing terms
- [ ] Fill in KELSON's registered business name and the DPO's contact in the Privacy Notice
- [ ] Appoint a Data Protection Officer
- [ ] Check NPC registration requirement; register if required
- [ ] Write a personal data breach response plan (notify NPC and affected people within 72 hours)
- [ ] Written permission on file for field-survey shelf photos
- [ ] Contracts / data processing terms with cloud providers
- [ ] Decide on the Internet Transactions Act question
- [ ] Lawyer review of the three sharing levels and the per-application credit consent
- [ ] Before the credit pilot: pick an SEC-licensed lending partner; data-sharing agreement; RA 9510 / CIC position; loan disclosures

## Weekly log
<!-- The weekly check adds an entry here, newest first: date, what was checked, sources (links), findings, impact on KWADERNO, plan changes. -->
- 2026-11-28 (update) — App: Privacy Notice v2026-11-28.2 with three owner-chosen sharing levels, per-application credit consent (no data to lenders yet), 5-store minimum on exports. Added lending and credit laws (RA 9510, RA 9474, RA 8556, RA 11765, RA 3765) to the table and the weekly check. No new legal developments checked in this entry.
- 2026-11-28 — Baseline written. App updated: Privacy Notice v2026-11-28, consent at sign-up, AI-photo opt-in, data rights, compliance card.
