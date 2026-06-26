import { Navbar } from "@/components/site/navbar";
import { Hero } from "@/components/site/hero";
import { TrustStrip } from "@/components/site/trust-strip";
import { Services } from "@/components/site/services";
import { Transformations } from "@/components/site/transformations";
import { Process } from "@/components/site/process";
import { Team } from "@/components/site/team";
import { Faq } from "@/components/site/faq";
import { Booking } from "@/components/site/booking";
import { Testimonials } from "@/components/site/testimonials";
import { Footer } from "@/components/site/footer";
import { MobileCta } from "@/components/site/mobile-cta";

export default function Home() {
  return (
    <>
      <Navbar />
      <main className="flex-1">
        <Hero />
        <TrustStrip />
        <Services />
        <Transformations />
        <Process />
        <Team />
        <Testimonials />
        <Faq />
        <Booking />
      </main>
      <Footer />
      {/* spacer so the fixed mobile bar never hides footer content */}
      <div aria-hidden className="h-16 lg:hidden" />
      <MobileCta />
    </>
  );
}
