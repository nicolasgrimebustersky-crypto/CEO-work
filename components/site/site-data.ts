import {
  Home,
  Building2,
  Factory,
  Trees,
  Droplets,
  Sparkles,
  Snowflake,
  type LucideIcon,
} from "lucide-react";

export const BUSINESS = {
  name: "Grime Bustersky",
  shortName: "Grime Busters KY",
  tagline: "Louisville's Leading Pressure Washing & Landscaping Crew",
  phoneDisplay: "(502) 599-6855",
  phoneHref: "tel:+15025996855",
  hours: "Mon–Sun, 9:00 AM – 7:00 PM",
  area: "Louisville & Oldham County, KY",
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
  {
    icon: Snowflake,
    title: "Snow Removal",
    description:
      "When winter hits Louisville & Oldham County, we keep your driveways and walkways clear, safe, and ice-free.",
    points: ["Driveways & walkways", "Salting & de-icing", "Reliable storm response"],
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

export type MediaItem = {
  type: "image" | "video";
  src: string;
  alt: string;
  poster?: string;
};

// Auto-sliding "Our Work" gallery — real Grime Busters KY job photos.
export const GALLERY: MediaItem[] = [
  { type: "image", src: "/media/g01.jpg", alt: "Freshly cleaned composite deck at sunset" },
  { type: "image", src: "/media/g02.jpg", alt: "Spotless deck stairs with white railing" },
  { type: "image", src: "/media/g03.jpg", alt: "Pressure-washed brick paver walkway" },
  { type: "image", src: "/media/g04.jpg", alt: "Clean concrete driveway" },
  { type: "image", src: "/media/g05.jpg", alt: "Brick retaining wall and railing, cleaned" },
  { type: "image", src: "/media/g06.jpg", alt: "Aggregate stone steps after washing" },
  { type: "image", src: "/media/g07.jpg", alt: "Bright, clean entry steps and column" },
  { type: "image", src: "/media/g08.jpg", alt: "Tidy stone path and fresh landscaping" },
  { type: "image", src: "/media/g09.jpg", alt: "Fresh mulch bed and trimmed landscaping" },
  { type: "image", src: "/media/g10.jpg", alt: "Clean landscaped yard with fresh mulch" },
  { type: "image", src: "/media/g11.jpg", alt: "Manicured yard with new mulch beds" },
  { type: "image", src: "/media/g12.jpg", alt: "Grime Bustersky truck loaded with pro gear" },
  { type: "image", src: "/media/g13.jpg", alt: "Pressure washer nozzle in action" },
];
