import type { Metadata } from "next";
import {
  Inter,
  Plus_Jakarta_Sans,
  Space_Grotesk,
  JetBrains_Mono,
} from "next/font/google";
import { cookies } from "next/headers";
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
  // Admin-only r10n theme. SSR-read the cookie so there is no flash of the wrong
  // theme. With no cookie (the default for everyone) no data-theme is set, so the
  // app renders exactly as it does today.
  const cookieStore = await cookies();
  const r10nOn = cookieStore.get("r10n_theme")?.value === "on";

  return (
    <html
      lang="en"
      {...(r10nOn ? { "data-theme": "r10n" } : {})}
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
