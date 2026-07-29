import { redirect } from "next/navigation";

/** The map is the landing screen, not a menu. */
export default function Home() {
  redirect("/map");
}
