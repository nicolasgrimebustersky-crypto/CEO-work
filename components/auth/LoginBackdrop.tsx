/**
 * The green-on-black ribbons behind the login card.
 *
 * Decorative and nothing else — hidden from assistive tech, no pointer events,
 * and painted entirely by the `.gb-ribbon*` rules in globals.css so the
 * markup is four empty boxes. The vignette on top pulls the eye to the card
 * and keeps the brightest part of the bands from competing with the form.
 */
export function LoginBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden bg-canvas">
      <div className="gb-ribbon gb-ribbon-3" />
      <div className="gb-ribbon gb-ribbon-2" />
      <div className="gb-ribbon gb-ribbon-1" />
      <div className="gb-ribbon gb-ribbon-edge" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,rgba(0,0,0,0.72)_100%)]" />
    </div>
  );
}
