import Image from "next/image";

import { BRAND_PROFILE, brandAsset } from "@/lib/brand";

/**
 * The brand's lockup.
 *
 * logo.png in the brand's asset folder, written by scripts/generate-icons.mjs
 * from the artwork in assets/. The source is a 1.1MB print-resolution render and has no business
 * being fetched by a phone to fill a drawer header.
 *
 * This copy has the black field keyed out to alpha, so the mark belongs to
 * whatever surface it lands on rather than sitting in a black rectangle a few
 * shades off the panel behind it. The opaque JPEG next to it is the PDF's —
 * that one goes on a black band, and PDF can carry JPEG bytes verbatim.
 */

/** Intrinsic size of the logo, so Next can reserve the right box. */
export const LOGO_WIDTH = BRAND_PROFILE.logoSize.width;
export const LOGO_HEIGHT = BRAND_PROFILE.logoSize.height;
export const LOGO_ASPECT = LOGO_WIDTH / LOGO_HEIGHT;

export function Logo({
  className = "",
  width = 120,
  priority = false,
}: {
  className?: string;
  /** Rendered width in CSS pixels; the height follows the artwork. */
  width?: number;
  priority?: boolean;
}) {
  return (
    <Image
      src={brandAsset("/logo.png")}
      alt={BRAND_PROFILE.logoAlt}
      width={LOGO_WIDTH}
      height={LOGO_HEIGHT}
      priority={priority}
      className={className}
      style={{ width, height: "auto" }}
      // Small and fixed wherever it appears, so one size covers every screen.
      sizes="240px"
    />
  );
}
