import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const geist = localFont({ src: "./fonts/GeistVF.woff", display: "swap", variable: "--font-geist" });

export const metadata: Metadata = {
  title: "Max Travel CRM — Agency Operating System",
  description: "Agency operations workspace for travel teams: customers, bookings, visa files, documents, payments and a full audit trail.",
  // A private agency workspace must never appear in a search index.
  robots: { index: false, follow: false },
};

// Density is applied before the first paint, from the stored choice. Running it here rather than in
// an effect avoids showing comfortable rows and then snapping to compact after hydration; the
// server-rendered attribute is the comfortable default, which is also what a first-time reader gets.
const DENSITY_BOOT = `try{var d=localStorage.getItem("tos.density");document.documentElement.dataset.density=d==="compact"?"compact":"comfortable"}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-density="comfortable">
      <body className={`${geist.className} antialiased`}>
        <script dangerouslySetInnerHTML={{ __html: DENSITY_BOOT }} />
        {children}
      </body>
    </html>
  );
}
