import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The browser runner and Prisma need real Node, not a bundled/edge runtime.
  serverExternalPackages: ["playwright", "@prisma/client"],
};

export default nextConfig;
