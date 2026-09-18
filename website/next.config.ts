import type { NextConfig } from "next";

// DEPLOY_TARGET selects the build flavor:
//   "static" -> static export to ./out at the site root (Cloudflare Pages, Netlify, any static host)
//   "pages"  -> static export under /<repo> (GitHub Pages project sites)
//   unset    -> normal Next.js build (local dev / Vercel)
const target = process.env.DEPLOY_TARGET;
const repo = process.env.PAGES_REPO ?? "CEO-work";

const staticExport: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
};

const nextConfig: NextConfig =
  target === "pages"
    ? { ...staticExport, basePath: `/${repo}`, assetPrefix: `/${repo}/` }
    : target === "static"
      ? staticExport
      : {};

export default nextConfig;
