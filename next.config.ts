import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "bcryptjs"],
  experimental: { serverActions: { bodySizeLimit: "20mb" } },
};

export default nextConfig;
