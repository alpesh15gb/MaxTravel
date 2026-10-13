/** @type {import('next').NextConfig} */

// An agency workspace is a private system: it should never be framed by another site, never be
// sniffed into a different content type, and should not advertise the framework version it runs.
// TLS/HSTS belongs to the reverse proxy that terminates HTTPS in front of this app.
const securityHeaders = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig = {
  serverExternalPackages: ["pdfkit", "exceljs"],
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
