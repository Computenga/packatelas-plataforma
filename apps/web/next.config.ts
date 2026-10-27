import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // App 100% autenticada y dinámica: sin Cache Components por ahora.
  output: "standalone",
  transpilePackages: ["@packatelas/db"],
  serverExternalPackages: ["pg", "@prisma/adapter-pg"],
  poweredByHeader: false,
  // Encabezados de seguridad: nadie puede meter la plataforma en un iframe (clickjacking),
  // el navegador no adivina tipos de archivo y siempre usa HTTPS.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self' https://www.mercadopago.com.mx https://*.mercadopago.com.mx https://*.mercadopago.com" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=(), payment=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
        ],
      },
    ];
  },
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
