import "./globals.css";
import { AuthProvider } from "@/components/providers/auth-provider";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";

export const metadata = {
  title: "Hominal Healthcare CRM",
  description: "Cloud synced home healthcare CRM"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <a href="#crm-main-content" className="skip-link">Skip to main content</a>
        <AuthProvider>
          <ConfirmProvider>{children}</ConfirmProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
