# Service-area pages — drafted, not deployed

**Why these live here and not in the site repo:** I don't have access to the
grimebusterskyllc.com source repo from this environment — no local clone, no
`gh` auth, no remote URL on file anywhere in this system. I pulled the live
site's rendered HTML, JS bundles, and JSON-LD instead to match voice, NAP
data, and existing schema exactly. **Blocker for Nicolas:** point me at the
repo (path or `gh` access) and I'll open this as an actual PR/diff against
it. Until then, this is the full content and code, ready to paste in.

## What's here

- `data.ts` — the five towns (La Grange, Crestwood, Pewee Valley, Buckner,
  Goshen). Drop into `lib/service-areas.ts` or equivalent.
- `app/service-areas/[town]/page.tsx` — one dynamic route, statically
  generated per town (`generateStaticParams`), not five duplicate files.
  Drop into the app router at that same path.

## What I matched from the live site (not invented)

- NAP, hours, phone, social links, and the existing `LocalBusiness` /
  `HomeAndConstructionBusiness` JSON-LD shape — pulled verbatim from
  grimebusterskyllc.com's homepage `<script type="application/ld+json">`.
- Service descriptions and FAQ copy — reused from the live homepage
  (Residential Pressure Washing, Commercial Power Washing, Industrial
  Cleaning, Landscaping & Mulching, Snow Removal), localized minimally
  (town name, service-area framing) rather than rewritten.
- Tailwind class tokens (`bg-background`, `text-foreground`, `bg-card`,
  `border-border`, `text-primary`, rounded-xl cards) — inferred from the
  live page's rendered HTML, consistent with the shadcn/ui CSS-variable
  convention the homepage already uses.
- ZIP codes per town (La Grange 40031, Crestwood 40014, Pewee Valley 40056,
  Buckner 40010, Goshen 40026) — public record, used in `PostalAddress`
  schema and page copy.

## What's new (mine to flag, not to invent past this)

- Each page's opening paragraph and the "why local" section are new copy,
  built from BRAND.md positioning (soft wash, correct chemistry, protecting
  surfaces, 25-mile Crestwood radius) rather than pure boilerplate swap.
  This is the one place I went past "structure existing copy" into writing
  new sentences — flagging per my own standing rule. If Reese or Tyler want
  a real copy pass (specific streets, HOA names, job photos per town), this
  is a solid first draft to work from, not a final version.
- No fake testimonials. I did not attribute any of the real Google reviews
  to a specific town — none of them mention one, and doing that would be
  fabricating attribution. Testimonial section reuses the site's real
  aggregate rating (4.9★, 14 reviews) and two unattributed-to-town reviews
  verbatim.

## Still needed before this is a real diff

1. Actual repo access (see blocker above).
2. Confirm shared header/nav/footer component names/import paths — I built
   the page self-contained (own header/footer markup matching the live
   site's visible nav) since I don't know the real component names. Should
   be swapped for the real `<SiteHeader />` / `<SiteFooter />` (or whatever
   they're actually called) so nav/footer stay DRY across the site.
3. `sitemap.xml` currently lists only the homepage (confirmed via
   `curl https://grimebusterskyllc.com/sitemap.xml`). If it's generated via
   `app/sitemap.ts`, these five routes need adding there. If it's a static
   file in `public/`, same thing by hand. I can't tell which without the
   repo.
4. Internal linking: nothing on the current homepage links to
   `/service-areas/*` yet. At minimum the footer's existing "Proudly serving
   Louisville & Oldham County, KY — including La Grange, Crestwood,
   Prospect, Pewee Valley, Buckner, Goshen, Ballardsville" line is the
   natural place to turn those five names into links once these pages
   exist.
5. Real per-town job photos. `context/ASSETS.md` has zero photos indexed
   against any job (`beforePhotos`/`afterPhotos` empty in every CRM record
   per Marcus's 2026-08-22 note) — these pages currently reuse the generic
   site-wide before/after image. A town page with a real photo from that
   town is a materially stronger ranking signal than one without; this is
   the next real gap once the pages themselves are live.
