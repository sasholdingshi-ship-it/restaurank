import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { MobileShell } from "@/components/MobileShell";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Yatai — Gestion Franchise",
  description: "Gestion des commandes, recettes et facturation Yatai",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Yatai",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#111827",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" className={`${inter.className} h-full`}>
      <body className="h-full bg-gray-50">
        <MobileShell>{children}</MobileShell>
        <script
          dangerouslySetInnerHTML={{
            __html: `if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js')`,
          }}
        />
      </body>
    </html>
  );
}
