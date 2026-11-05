# Launch legal review — things to settle before a full launch

The developer's list: what could expose the person who builds and ships
this CRM (and the businesses running it) to legal or tax trouble. Covers
both deployments of this codebase. Not legal advice — a list of questions
to take to a lawyer and a CPA before selling or widely launching this
software.

Note: this repository is public. Nothing here names a client or another
business's account details; keep it that way.

Confidence tags: **[Certain]** checked against a primary source or the
code; **[Likely]** strong inference; **[Guessing]** filling a gap.

Each feature PR adds its own entries here. Highest risk first.

---

## 1. Texting customers (TCPA) — highest lawsuit risk

- **What:** automated texts — on-the-way, reminders, lead nurture, SMS
  blasts, and (planned) rain-day reschedule notices and seasonal upsell
  campaigns.
- **Risk:** [Likely] The federal TCPA allows private lawsuits at $500–$1,500
  *per text* sent without the right consent; marketing texts need prior
  express *written* consent. Class actions over texting are common.
- **What the code does today:** [Certain] consent and opt-out are tracked
  (`lib/smsConsent.ts`), quiet hours enforced, and every send goes through
  one chokepoint with tests (`tests/smsChokepoint.test.mjs`).
- **Before launch:** have a lawyer review the consent wording and how it is
  captured (especially for imported clients who never opted in), confirm
  A2P 10DLC registration, and keep upsell campaigns limited to customers
  with marketing consent.

## 2. Payments through personal Venmo

- **Risk:** [Likely] Venmo's user agreement does not allow taking payment for
  goods and services into a personal profile. Realistic outcome is an
  account limit or freeze, not a lawsuit. The "Pay with Venmo" button sends
  customers to whatever handle a deployment configures.
- **Before launch:** every deployment uses a Venmo business profile
  (~1.9% + $0.10), and the setup docs say so.

## 3. Venmo name and logo

- [Certain] The hand-drawn Venmo "V" was removed (#92); the
  button is the app's own style and only names Venmo.
- **Before launch:** if Venmo checkout through PayPal/Braintree is ever
  integrated, use only Venmo's official button assets and guidelines.

## 4. Kentucky sales tax

- **Risk:** [Likely] Kentucky taxes landscaping and lawn care at 6%
  (103 KAR 26:131, since 2018). [Guessing] Whether window cleaning and
  pressure washing fall under its taxable "janitorial services" is unclear.
  A business that should have collected it owes it anyway — a state
  assessment plus penalties, not a lawsuit.
- **Developer exposure:** if the CRM computes or omits tax wrongly and a
  business relies on it. The sales-tax feature is configurable per
  deployment and ships off until the business's CPA confirms.

## 5. Tax estimate, mileage, 1099 and pay figures

- **Risk:** [Likely] Low lawsuit risk for the owners themselves; real risk if
  this software is sold to other businesses and someone relies on a wrong
  figure. Screens already say it is a set-aside estimate, not a return.
- **Facts to re-check every year:** federal brackets and standard
  deduction, Social Security wage base, Kentucky rate and deduction
  (`TAX_YEARS` in `lib/taxEstimate.ts`), IRS mileage rate, and the 1099-NEC
  threshold. [Likely] That threshold is $2,000 for payments made in 2026
  under the One Big Beautiful Bill Act (was $600), indexed from 2027.
- **Before launch:** terms of service with a "not tax advice" clause and
  limitation of liability, if this is sold.

## 6. Crew: worker classification, hours, pay, location

- **Risk:** [Likely] Calling a worker a 1099 contractor when the law says
  employee brings back taxes and penalties (IRS, Kentucky) and possible
  wage claims. W-2 hourly workers are owed overtime past 40 hours (FLSA).
- **Location:** live location sharing and planned GPS mileage gap-fill.
  [Guessing] Kentucky has no specific employee-tracking statute, but get
  written consent and track only during work.
- **W-9s:** contain SSNs. [Likely] A leak triggers Kentucky's breach
  notification law (KRS 365.732). Owner-only storage; consider not storing
  the image at all once the TIN is recorded.
- **Before launch:** employment lawyer or payroll service for
  classification; written location-tracking consent in the crew onboarding.

## 7. Customer data and privacy

- [Certain] Real client names were committed to this **public** repo's
  history in test fixtures (removed in #91, still in git history).
- **Before launch:** make CEO-work private (or rewrite history), publish a
  privacy policy that matches what is collected (addresses, phones, photos
  of homes, payment emails), and keep the Firebase rules tests green.

## 8. Route optimization vs. Jobber and others

- **Risk:** [Likely] Low. The method (nearest neighbour, 2-opt, or-opt) is
  textbook from the 1950s–60s and widely published. Nothing was copied
  from Jobber's code, text or screens; "how Jobber does it" was used only to
  decide behaviour (start from a visit or current location).
- [Guessing] Field-service companies do hold routing/scheduling patents.
  Matters if this software is **sold**, not for two businesses using it
  internally.
- **Before launch (if selling):** a freedom-to-operate search on routing and
  scheduling, plus payment-to-invoice matching.

## 9. Google Maps Platform terms

- **Risk:** [Likely] Distance Matrix results are used for drive times and
  routing. Google's terms limit caching and require attribution when Google
  data is shown without a Google map.
- **Before launch:** show "Powered by Google" next to road-time figures, and
  confirm nothing caches results beyond what the terms allow.

## 10. Reading Venmo emails automatically

- **Risk:** [Guessing] Low. The owner forwards their own mail to the CRM's
  inbound address (Resend). Make sure the privacy policy mentions that
  payment notifications are processed by a third party.

## 11. Open-source licenses

- [Certain] Production dependencies are MIT/Apache/BSD/ISC, plus LGPL
  (Next.js image tool, via sharp/libvips). Fine for running a website.
- **Before launch (if distributing an app binary):** include license notices.

## 12. Reviews

- **Before launch:** [Guessing] confirm review requests go to every finished
  customer, not only happy ones. Google prohibits "review gating", and the
  FTC's 2024 consumer-review rule bans suppressing negative reviews.

## 13. Selling the CRM to other businesses (later)

- Needs: terms of service, privacy policy, data processing terms, a
  security review, the patent search in 8, and the classification and tax
  disclaimers above.
