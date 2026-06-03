import {
  Home,
  Building2,
  Factory,
  Trees,
  Droplets,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

export const BUSINESS = {
  name: "Grime Bustersky",
  shortName: "Grime Busters KY",
  tagline: "Louisville's Leading Pressure Washing & Landscaping Crew",
  phoneDisplay: "(502) 599-6855",
  phoneHref: "tel:+15025996855",
  hours: "Mon–Sun, 9:00 AM – 7:00 PM",
  area: "Louisville, KY & surrounding areas",
  founders: "Nicolas Timmons & Noah Perkins",
} as const;

export type Service = {
  icon: LucideIcon;
  title: string;
  description: string;
  points: string[];
};

export const SERVICES: Service[] = [
  {
    icon: Home,
    title: "Residential Pressure Washing",
    description:
      "Bring back the curb appeal of your home — driveways, sidewalks, decks, patios, and vinyl siding cleaned to look brand new.",
    points: ["Driveways & walkways", "House & siding wash", "Decks & patios"],
  },
  {
    icon: Building2,
    title: "Commercial Power Washing",
    description:
      "Keep your storefront and property spotless and professional, with minimal disruption to your operations.",
    points: ["Storefronts & entries", "Parking lots", "Dumpster pads"],
  },
  {
    icon: Factory,
    title: "Industrial Cleaning",
    description:
      "Heavy-duty cleaning for facilities and warehouses — built for large-scale jobs and tough buildup.",
    points: ["Warehouses", "Equipment & floors", "Large-scale jobs"],
  },
  {
    icon: Trees,
    title: "Landscaping & Mulching",
    description:
      "Finish the transformation with fresh mulch and tidy landscaping that makes the whole property pop.",
    points: ["Fresh mulch install", "Bed cleanup & edging", "Seasonal refresh"],
  },
];

export const STATS = [
  { value: "100%", label: "Satisfaction focused" },
  { value: "7-Day", label: "Availability" },
  { value: "Free", label: "Quotes, always" },
  { value: "Local", label: "Louisville owned" },
];

export const STEPS = [
  {
    icon: Droplets,
    title: "Request a free quote",
    description:
      "Call or book online. Tell us what needs cleaning and we'll give you a fast, no-pressure estimate.",
  },
  {
    icon: Sparkles,
    title: "We bust the grime",
    description:
      "Our crew shows up on time with pro-grade gear and treats your property like our own.",
  },
  {
    icon: Trees,
    title: "Enjoy the transformation",
    description:
      "Step back and admire the curb appeal — and ask about a landscaping refresh to finish it off.",
  },
];

export const TESTIMONIALS = [
  {
    quote:
      "We were amazed by the exceptional service provided by Grime Busters KY. Our property looks brand new, and we couldn't be happier with the results.",
    author: "Marian S.",
    role: "Louisville Homeowner",
  },
  {
    quote:
      "Fast, friendly, and the driveway has never looked this clean. These guys take real pride in their work.",
    author: "Happy Customer",
    role: "Residential Client",
  },
  {
    quote:
      "Booked a commercial wash and they made our storefront shine without slowing down business. Highly recommend.",
    author: "Local Business",
    role: "Commercial Client",
  },
];
