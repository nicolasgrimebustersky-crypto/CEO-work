/**
 * Stand-in for lib/demo/fixtures.ts in a normal build.
 *
 * next.config.ts aliases the fixtures module to this one whenever
 * NEXT_PUBLIC_DEMO_MODE is not "true", so the invented customers, addresses and
 * figures are not merely unreachable in a production bundle — they are not in
 * it. Types still come from the real module at typecheck time; only the bundled
 * bytes are swapped.
 */
import type { AppNotification } from "@/lib/db/notifications";
import type { AppUser, Customer, Job, Quote } from "@/lib/types";

export const DEMO_NICK = "demo-nick";
export const DEMO_DANA = "demo-dana";

export const demoUsers: AppUser[] = [];
export const demoCustomers: Customer[] = [];
export const demoJobs: Job[] = [];
export const demoQuotes: Quote[] = [];
export const demoNotifications: AppNotification[] = [];
