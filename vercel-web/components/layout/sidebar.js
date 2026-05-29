"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { appConfig } from "@/lib/config";
import { modules } from "@/lib/navigation";
import { useAuth } from "@/components/providers/auth-provider";
import { hasPermission } from "@/lib/permissions";
import { BrandLogo } from "@/components/ui/brand-logo";

export function Sidebar({ open = false, onNavigate }) {
  const pathname = usePathname();
  const auth = useAuth();

  const navItems = modules.filter(function (item) {
    if (!item.permission) return Boolean(auth.session);
    return hasPermission(auth.profile?.role, item.permission);
  });

  return (
    <aside
      id="crm-sidebar-nav"
      className={"crm-sidebar" + (open ? " crm-sidebar-open" : "")}
      aria-label="Primary navigation"
    >
      <div className="crm-brand">
        <BrandLogo
          src={appConfig.companyLogo}
          alt={appConfig.companyName + " logo"}
          className="crm-brand-logo"
          width={140}
          height={42}
        />
        <div className="crm-logo">{appConfig.companyName}</div>
      </div>
      <div className="crm-tagline">{appConfig.companyTagline}</div>
      <nav className="crm-nav" aria-label="Modules">
        {navItems.map(function (item) {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={active ? "active" : ""}
              aria-current={active ? "page" : undefined}
              onClick={function () { if (onNavigate) onNavigate(); }}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
