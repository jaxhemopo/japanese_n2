/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  experimental: {
    // Inline critical CSS, defer the rest — addresses unused-css-rules
    // and render-blocking-resources audits. Requires critters (devDep).
    optimizeCss: true,

    // Tree-shake Supabase imports to reduce unused JS in page bundles.
    optimizePackageImports: ['@supabase/ssr', '@supabase/supabase-js'],
  },
};

export default nextConfig;
