import { ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type ImagePlaceholderProps = {
  /** Drop a real photo in /public/photos and pass its path (e.g. "/photos/driveway.jpg"). */
  src?: string;
  alt: string;
  label?: string;
  className?: string;
  imgClassName?: string;
};

/**
 * Branded image slot. While `src` is empty it renders an on-brand placeholder so
 * the layout looks finished; pass a real photo path to swap it in instantly.
 */
export function ImagePlaceholder({
  src,
  alt,
  label = "Your photo here",
  className,
  imgClassName,
}: ImagePlaceholderProps) {
  if (src) {
    return (
      // A plain <img>, deliberately: the site is a static export with
      // `images: { unoptimized: true }`, so next/image would run the same bytes
      // through a wrapper that cannot optimise them. Every current caller
      // renders below the fold, hence the lazy decode.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        className={cn("h-full w-full object-cover", imgClassName)}
      />
    );
  }

  return (
    <div
      role="img"
      aria-label={alt}
      className={cn(
        "relative flex h-full w-full flex-col items-center justify-center gap-3 overflow-hidden",
        "bg-[radial-gradient(circle_at_30%_20%,hsl(var(--primary)/0.28),transparent_55%),radial-gradient(circle_at_80%_80%,hsl(var(--sand)/0.12),transparent_50%)]",
        "bg-card text-muted-foreground",
        className,
      )}
    >
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.18] [background-image:linear-gradient(hsl(var(--primary)/0.5)_1px,transparent_1px),linear-gradient(90deg,hsl(var(--primary)/0.5)_1px,transparent_1px)] [background-size:28px_28px]"
      />
      <div className="relative grid size-12 place-items-center rounded-full bg-primary/15 text-primary ring-1 ring-primary/30">
        <ImageIcon className="size-6" />
      </div>
      <span className="relative text-xs font-medium tracking-wide uppercase">
        {label}
      </span>
    </div>
  );
}
