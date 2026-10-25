import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // App 100% autenticada y dinámica: sin Cache Components por ahora.
  output: "standalone",
  transpilePackages: ["@packatelas/db"],
  serverExternalPackages: ["pg", "@prisma/adapter-pg"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
