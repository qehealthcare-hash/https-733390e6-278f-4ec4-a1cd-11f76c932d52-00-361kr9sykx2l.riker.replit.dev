import { Navbar } from "@/components/sections/navbar";
import { Footer } from "@/components/sections/footer";

/**
 * Marketing route group layout.
 *
 * Every page under app/(marketing)/* gets the sticky Navbar + Footer.
 * Auth and dashboard route groups have their own layouts and do NOT
 * inherit this chrome.
 *
 * Skip-link sits at the very top of the DOM so keyboard users can
 * jump past the navbar to the main content with a single tab — this
 * is a WCAG 2.4.1 (Bypass Blocks) requirement that costs nothing.
 */
export default function MarketingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-svh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-md focus:bg-[var(--color-primary-500)] focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to main content
      </a>

      <Navbar />

      <main id="main" className="flex-1">
        {children}
      </main>

      <Footer />
    </div>
  );
}
