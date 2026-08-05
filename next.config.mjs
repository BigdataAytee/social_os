/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // lib/db-health.ts reads these folder names at runtime to tell whether the
    // database has applied every migration this build ships. Next's file
    // tracing only bundles files it can see being imported, and these are read
    // by path — without this they are absent in production and the check
    // silently no-ops, which is the case it exists to catch.
    outputFileTracingIncludes: {
      "/**": ["./prisma/migrations/**"],
    },
  },
};

export default nextConfig;
