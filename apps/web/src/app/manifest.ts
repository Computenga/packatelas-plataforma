import type { MetadataRoute } from "next";

// App instalable en Android e iPhone [P02].
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Packatelas",
    short_name: "Packatelas",
    description: "Operación, entregas y cobranza de Packatelas",
    start_url: "/",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#1f4fa3",
    lang: "es-MX",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
