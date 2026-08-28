import { routes } from "@/lib/routes";
import {
  AgentIcon,
  CalendarIcon,
  ChartIcon,
  InvoiceIcon,
  MapIcon,
  ChatIcon,
  MessageIcon,
  RouteIcon,
  PeopleIcon,
  PersonIcon,
  PipelineIcon,
  PriceBookIcon,
  ReportIcon,
  type NavIconProps,
} from "./navIcons";

export interface NavItem {
  href: string;
  label: string;
  icon: (props: NavIconProps) => React.JSX.Element;
  /** Shown under the label in the drawer, where there is room to explain. */
  hint?: string;
}

/**
 * The five that earn a permanent thumb position.
 *
 * The test is what you reach for standing on somebody's porch: where am I,
 * what's booked, who owes me, who's warm, who is this. Reports and settings
 * are things you read at the kitchen table, so they live in the drawer.
 */
export const TABS: NavItem[] = [
  {
    href: routes.map,
    label: "Map",
    icon: MapIcon,
    hint: "Every door you've pinned, and where the crew are",
  },
  {
    href: routes.schedule,
    label: "Jobs",
    icon: CalendarIcon,
    hint: "The calendar, and the order you're driving today",
  },
  {
    href: routes.invoices,
    label: "Money",
    icon: InvoiceIcon,
    hint: "Estimates, invoices, and what's still owed",
  },
  {
    href: routes.pipeline,
    label: "Leads",
    icon: PipelineIcon,
    hint: "Who's warm, and what happens to them next",
  },
  {
    href: routes.customers,
    label: "People",
    icon: PeopleIcon,
    hint: "Every customer, their history and their notes",
  },
];

/** Everything else, reachable from the drawer. */
export const DRAWER_ONLY: NavItem[] = [
  {
    href: routes.knockRoutes,
    label: "Routes",
    icon: RouteIcon,
    hint: "Doors to knock, and who is walking them",
  },
  {
    href: routes.chat,
    label: "Team chat",
    icon: ChatIcon,
    hint: "Talk to the crew inside the app — no texts, no cost",
  },
  {
    href: routes.messages,
    label: "Messages",
    icon: MessageIcon,
    hint: "Texts to and from customers, and who is waiting",
  },
  {
    href: routes.marcus,
    label: "Agents",
    icon: AgentIcon,
    hint: "Marcus and the five specialists — what they're on, what needs you",
  },
  {
    href: routes.dashboard,
    label: "Dashboard",
    icon: ChartIcon,
    hint: "Today at a glance",
  },
  {
    href: routes.services,
    label: "Services",
    icon: PriceBookIcon,
    hint: "Your prices and wording",
  },
  {
    href: routes.reports,
    label: "Reports",
    icon: ReportIcon,
    hint: "Revenue, doors, conversion",
  },
  {
    href: routes.account,
    label: "Account",
    icon: PersonIcon,
    hint: "Your profile and sign out",
  },
];

export const ALL_DESTINATIONS: NavItem[] = [...TABS, ...DRAWER_ONLY];

/** True for the destination itself and anything nested under it. */
export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
