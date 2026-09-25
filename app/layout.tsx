import type { Metadata } from "next";
import {
  Inter,
  Plus_Jakarta_Sans,
  Space_Grotesk,
  JetBrains_Mono,
} from "next/font/google";
import { Toaster } from "sonner";
import { SkewGuard } from "@/components/system/skew-guard";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta-sans",
  subsets: ["latin"],
  display: "swap",
});

// r10n theme fonts (additive). These only render when data-theme="r10n" is set.
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  display: "swap",
});

const jetBrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Kracked Sales",
  description: "Sales command centre for Kracked",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // r10n is THE theme now (Jack, 2026-08-25: "we'll just stick with the r10n theme, we won't
  // use that old theme"). It used to be an admin-only cookie opt-in, which meant anyone WITHOUT
  // the cookie — Gage, Kelsey, Alice — silently kept the old look. Setting it unconditionally is
  // what actually retires the old theme; hiding the toggle alone would have stranded them on it
  // with no way to switch. The old styles remain in the stylesheet, unreferenced, so reverting is
  // a one-line change.

  return (
    <html
      lang="en"
      data-theme="r10n"
      className={`${inter.variable} ${plusJakartaSans.variable} ${spaceGrotesk.variable} ${jetBrainsMono.variable} h-full`}
    >
      <body className="h-full antialiased">
        {children}
        <SkewGuard />
        <Toaster position="bottom-right" richColors />
      </body>
    </html>
  );
}
