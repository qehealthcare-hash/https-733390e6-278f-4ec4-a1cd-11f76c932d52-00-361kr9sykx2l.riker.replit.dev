import "./globals.css";
import { AuthProvider } from "@/components/providers/auth-provider";

export const metadata = {
  title: "Hominal Healthcare CRM",
  description: "Cloud synced home healthcare CRM"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
