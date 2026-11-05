import type { Metadata, Viewport } from "next";
import { Barlow, Big_Shoulders } from "next/font/google";
import "./globals.css";

// Barlow (letra de señalamiento) para el texto; Big Shoulders (letrero industrial) para títulos y cifras.
const barlow = Barlow({ variable: "--font-barlow", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const display = Big_Shoulders({ variable: "--font-display-face", subsets: ["latin"], weight: "variable", axes: ["opsz"] });

export const metadata: Metadata = {
  title: { default: "Packatelas", template: "%s · Packatelas" },
  description: "Operación, entregas y cobranza de Packatelas",
  applicationName: "Packatelas",
  appleWebApp: { capable: true, title: "Packatelas", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#0E1B33",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es-MX" className={`${barlow.variable} ${display.variable} h-full`}>
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
