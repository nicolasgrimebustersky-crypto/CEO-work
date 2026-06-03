import type { NextConfig } from "next";

// When building for GitHub Pages (CI sets DEPLOY_TARGET=pages) we emit a fully
// static export served from /<repo>. Normal `next build` (incl. Vercel) is
// unaffected and serves from the root with image optimization on.
const isPages = process.env.DEPLOY_TARGET === "pages";
const repo = process.env.PAGES_REPO ?? "CEO-work";

const nextConfig: NextConfig = isPages
  ? {
      output: "export",
      basePath: `/${repo}`,
      assetPrefix: `/${repo}/`,
      images: { unoptimized: true },
      trailingSlash: true,
    }
  : {};

export default nextConfig;
