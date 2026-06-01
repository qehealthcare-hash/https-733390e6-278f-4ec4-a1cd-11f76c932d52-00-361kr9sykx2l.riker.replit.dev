import "./globals.css";
import { AuthProvider } from "@/components/providers/auth-provider";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { ToastProvider } from "@/components/ui/toast";

export const metadata = {
  title: "Hominal Healthcare CRM",
  description: "Cloud synced home healthcare CRM"
};

// P1-6: Next 14+ requires viewport to be exported separately from metadata.
// Without this the mobile shell renders at desktop width, the modals scroll
// off-screen on phones, and the legacy iframe pinches into 320px columns.
export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <a href="#crm-main-content" className="skip-link">Skip to main content</a>
        <AuthProvider>
          <ConfirmProvider>
            <ToastProvider>{children}</ToastProvider>
          </ConfirmProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
