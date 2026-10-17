import { redirect } from "next/navigation";

/** The dashboard is the landing screen: today at a glance, then everything else. */
export default function Home() {
  redirect("/dashboard");
}
