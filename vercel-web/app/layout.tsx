import "./globals.css";
import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { AuthProvider } from "@/components/providers/auth-provider";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { ToastProvider } from "@/components/ui/toast";

export const metadata: Metadata = {
  title: "Hominal Healthcare CRM",
  description: "Cloud synced home healthcare CRM"
};

// P1-39: nonces are generated per request in middleware; pages must be dynamic
// so Next.js can attach the nonce to framework inline scripts at render time.
export const dynamic = "force-dynamic";

// P1-6: Next 14+ requires viewport to be exported separately from metadata.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="en" nonce={nonce}>
      <body>
        <a href="#crm-main-content" className="skip-link">
          Skip to main content
        </a>
        <AuthProvider>
          <ConfirmProvider>
            <ToastProvider>{children}</ToastProvider>
          </ConfirmProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
