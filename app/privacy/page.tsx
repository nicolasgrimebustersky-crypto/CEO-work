import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy · Grime Busters CRM",
};

/**
 * App Review requires a privacy policy reachable both from inside the app and
 * from a public URL entered in App Store Connect. Serving it as a route means
 * one document satisfies both — no separate site to keep in sync.
 *
 * TEMPLATE. The bracketed values must be filled in before submission; a policy
 * with placeholders in it is a guaranteed rejection under Guideline 5.1.1.
 */
export default function PrivacyPage() {
  return (
    <main className="h-full overflow-y-auto px-5 py-8">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-3 h-1.5 w-12 rounded-full bg-accent" />
        <h1 className="text-3xl font-black tracking-tight text-ink">Privacy Policy</h1>
        <p className="mt-2 text-base font-semibold text-muted">
          Grime Busters CRM · Last updated [DATE]
        </p>

        <Section title="Who this covers">
          <P>
            Grime Busters CRM is a private tool used by the two owners of
            [LEGAL BUSINESS NAME] (&ldquo;we&rdquo;) to run a pressure washing,
            landscaping and snow removal business in Oldham County, Kentucky. It
            is not offered to the public and has no other users.
          </P>
          <P>
            Questions about this policy or about data we hold:{" "}
            <strong className="text-ink">[CONTACT EMAIL]</strong>.
          </P>
        </Section>

        <Section title="Information about our crew">
          <P>The app collects the following about the two people who use it:</P>
          <List
            items={[
              "Email address and password, used only to sign in. Passwords are handled by Google Firebase Authentication and are never visible to us.",
              "Display name and phone number, entered by each user, shown to the other so they know who logged what.",
              "Precise location while location sharing is switched on, including while the app is in the background, so each user can see where the other is working. This can be switched off at any time on the Account screen, and switching it off stops both the collection and the sharing immediately.",
              "Photographs taken through the app of job sites.",
            ]}
          />
        </Section>

        <Section title="Information about customers">
          <P>
            When we knock a door or take a booking we record the customer&apos;s
            name, phone number, email address if given, property address and
            location, notes about the visit, quotes, scheduled work, prices, and
            before and after photographs of the work.
          </P>
          <P>
            We collect this to quote, schedule and carry out work that the
            customer has asked us about, and to keep a record of what was done.
            We do not sell it, rent it, or share it for advertising.
          </P>
        </Section>

        <Section title="Text messages">
          <P>
            We send SMS to customers about their own jobs: appointment
            confirmations, changes to a scheduled time, and follow-ups on a quote
            they asked for. Messages are sent through Twilio.
          </P>
          <P>
            Replying <strong className="text-ink">STOP</strong> to any message
            stops all further texts to that number. Reply{" "}
            <strong className="text-ink">HELP</strong> for contact information.
            Message and data rates may apply.
          </P>
        </Section>

        <Section title="Who we share it with">
          <P>
            Only the service providers that make the app work, each acting on our
            behalf:
          </P>
          <List
            items={[
              "Google Firebase — authentication, database and photo storage.",
              "Google Maps Platform — map display and converting a dropped pin into a street address.",
              "Twilio — sending and receiving text messages.",
              "Vercel — hosting.",
            ]}
          />
          <P>
            We will also disclose information if the law requires it. Nothing is
            sold, and there is no advertising or analytics tracking in this app.
          </P>
        </Section>

        <Section title="How long we keep it">
          <P>
            Customer records are kept for as long as we may need the service
            history, and no longer than [RETENTION PERIOD] after our last contact
            with that customer. Location positions are overwritten continuously
            and no historical trail is stored — only each user&apos;s most recent
            position is kept.
          </P>
        </Section>

        <Section title="Your choices">
          <List
            items={[
              "Location sharing can be turned off in the app on the Account screen, or revoked entirely in iOS Settings → Privacy & Security → Location Services.",
              "Camera access can be revoked in iOS Settings → Privacy & Security → Camera.",
              "A crew member can delete their account and profile from the Account screen inside the app. This removes their profile and signs them out permanently.",
              "A customer can ask us to correct or delete their record by contacting us at [CONTACT EMAIL]. We will action it within 30 days.",
            ]}
          />
        </Section>

        <Section title="Security">
          <P>
            Access is restricted to two named accounts; every other account is
            rejected at the database level. Data is encrypted in transit and at
            rest by our providers. Details of the access model are published in
            the project&apos;s SECURITY.md.
          </P>
        </Section>

        <Section title="Children">
          <P>
            This is a business tool. It is not directed at children and we do not
            knowingly collect information from anyone under 13.
          </P>
        </Section>

        <Section title="Changes">
          <P>
            If this policy changes we will update the date at the top and, where
            the change is significant, tell both users in the app.
          </P>
        </Section>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="mb-2 text-xl font-bold text-ink">{title}</h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-base leading-relaxed text-muted">{children}</p>;
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="flex list-disc flex-col gap-2 pl-5">
      {items.map((item) => (
        <li key={item} className="text-base leading-relaxed text-muted">
          {item}
        </li>
      ))}
    </ul>
  );
}
