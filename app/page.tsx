import { Navbar } from "@/components/site/navbar";
import { Hero } from "@/components/site/hero";
import { Services } from "@/components/site/services";
import { Transformations } from "@/components/site/transformations";
import { Process } from "@/components/site/process";
import { Team } from "@/components/site/team";
import { Booking } from "@/components/site/booking";
import { Testimonials } from "@/components/site/testimonials";
import { Footer } from "@/components/site/footer";

export default function Home() {
  return (
    <>
      <Navbar />
      <main className="flex-1">
        <Hero />
        <Services />
        <Transformations />
        <Process />
        <Team />
        <Testimonials />
        <Booking />
      </main>
      <Footer />
    </>
  );
}
