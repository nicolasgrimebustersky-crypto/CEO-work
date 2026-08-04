import Image from "next/image";

/**
 * The Grime Busters lockup.
 *
 * One derivative for the whole app — public/logo.jpg, written by
 * scripts/generate-icons.mjs from the artwork in assets/. The source is a
 * 1.1MB print-resolution render and has no business being fetched by a phone
 * to fill forty pixels.
 *
 * JPEG rather than PNG on purpose: the mark is a soft-shaded render on solid
 * black, which is the case PNG handles worst, and it sits on the app's own
 * near-black canvas so the missing alpha channel costs nothing.
 */

/** Intrinsic size of public/logo.jpg, so Next can reserve the right box. */
export const LOGO_WIDTH = 640;
export const LOGO_HEIGHT = 473;
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
      src="/logo.jpg"
      alt="Grime Busters KY — pressure washing"
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
