import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow the dev server to be reached through the ngrok tunnel (needed for
  // production OAuth, which requires browsing the app via the HTTPS redirect host).
  allowedDevOrigins: ["yonder-spirited-rake.ngrok-free.dev"],
};

export default nextConfig;
