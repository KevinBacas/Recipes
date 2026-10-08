import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "À table — Notre cuisine à deux", template: "%s · À table" },
  description: "Nos recettes, nos plats à venir et nos courses dans un même espace privé.",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#fbfaf8" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <a href="#main" className="skip-link">
          Aller au contenu
        </a>
        {children}
      </body>
    </html>
  );
}
