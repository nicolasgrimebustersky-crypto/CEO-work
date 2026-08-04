import { routes } from "@/lib/routes";
import {
  CalendarIcon,
  ChartIcon,
  InvoiceIcon,
  MapIcon,
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
  { href: routes.map, label: "Map", icon: MapIcon },
  { href: routes.schedule, label: "Jobs", icon: CalendarIcon },
  { href: routes.invoices, label: "Money", icon: InvoiceIcon },
  { href: routes.pipeline, label: "Leads", icon: PipelineIcon },
  { href: routes.customers, label: "People", icon: PeopleIcon },
];

/** Everything else, reachable from the drawer. */
export const DRAWER_ONLY: NavItem[] = [
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
