/**
 * The Grime Busters mark, inline.
 *
 * Inlined rather than loaded from /logo.svg so it paints with the first frame
 * — a drawer that opens showing an empty square for a moment looks broken,
 * and the whole file is smaller than the request that would fetch it.
 *
 * Keep in sync with public/logo.svg, which is the source the icons and splash
 * screens are generated from (scripts/generate-icons.mjs).
 */
export function Logo({ className = "size-10" }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={className} role="img" aria-label="Grime Busters">
      <defs>
        <linearGradient id="logo-clean" x1="0.15" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#7dedff" />
          <stop offset="0.42" stopColor="#00d9ff" />
          <stop offset="1" stopColor="#22c55e" />
        </linearGradient>
        <linearGradient id="logo-edge" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#22c55e" />
          <stop offset="0.55" stopColor="#8ef7ff" />
          <stop offset="1" stopColor="#00d9ff" />
        </linearGradient>
        <path
          id="logo-droplet"
          d="M256 68 C 256 68, 356 200, 356 262 a 100 100 0 1 1 -200 0 C 156 200, 256 68, 256 68 Z"
        />
        <clipPath id="logo-inside">
          <use href="#logo-droplet" />
        </clipPath>
        <clipPath id="logo-round">
          <rect width="512" height="512" rx="116" />
        </clipPath>
      </defs>

      <g clipPath="url(#logo-round)">
        <rect width="512" height="512" fill="#050607" />
        <g clipPath="url(#logo-inside)">
          <use href="#logo-droplet" fill="url(#logo-clean)" />
          <path d="M110 312 L420 268 L420 440 L110 440 Z" fill="#20262e" />
          <g fill="#39424e">
            <circle cx="176" cy="360" r="9" />
            <circle cx="238" cy="404" r="6" />
            <circle cx="300" cy="352" r="7.5" />
            <circle cx="330" cy="410" r="5" />
            <circle cx="205" cy="332" r="5" />
            <circle cx="270" cy="330" r="4" />
          </g>
          <path d="M104 314 L426 268 L426 289 L104 335 Z" fill="url(#logo-edge)" />
        </g>
        <ellipse
          cx="214"
          cy="228"
          rx="24"
          ry="34"
          fill="#ffffff"
          opacity="0.42"
          transform="rotate(-20 214 228)"
        />
      </g>
    </svg>
  );
}
