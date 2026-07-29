/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // 2026-07-29 measured-audit: the browserslist in package.json
  // (chrome>=90, firefox>=90, safari>=14, edge>=90) is read by the
  // Next.js build system to set polyfill/transform targets. No webpack
  // override needed here — package.json is authoritative.

  experimental: {
    // Inline critical CSS, defer the rest — addresses unused-css-rules
    // and render-blocking-resources audits. Requires critters (devDep).
    // NOTE: critters minifies but still generates external CSS for @font-face
    // bundles from next/font — Lighthouse flags these as "unused CSS" because
    // @font-face declarations don't directly style elements; the actual font
    // files ARE downloaded and used by the browser. This is a measurement
    // artifact, not a real waste vector.
    optimizeCss: true,

    // Tree-shake Supabase imports to reduce unused JS in page bundles.
    optimizePackageImports: ['@supabase/ssr', '@supabase/supabase-js'],
  },
};

export default nextConfig;
