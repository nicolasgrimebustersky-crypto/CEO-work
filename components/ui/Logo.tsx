import Image from "next/image";

/**
 * The Solid Acre lockup.
 *
 * public/logo.png, written by scripts/generate-icons.mjs from the artwork in
 * assets/. The source is a print-resolution render and has no business being
 * fetched by a phone to fill a drawer header.
 *
 * This is the reversed colourway — white where the printed logo is navy — on
 * a transparent field, because every surface it lands on in the app is navy.
 * The opaque JPEG next to it is the PDF's: that one goes on the navy header
 * band, and PDF can carry JPEG bytes verbatim.
 */

/** Intrinsic size of public/logo.png, so Next can reserve the right box. */
export const LOGO_WIDTH = 420;
export const LOGO_HEIGHT = 336;

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
      src="/logo.png"
      alt="Solid Acre Exterior & Grounds"
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
