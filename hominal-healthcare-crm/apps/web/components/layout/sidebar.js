"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { appConfig } from "@/lib/config";
import { modules } from "@/lib/navigation";
import { useAuth } from "@/components/providers/auth-provider";
import { hasPermission } from "@/lib/permissions";

export function Sidebar() {
  const pathname = usePathname();
  const auth = useAuth();

  return (
    <aside className="crm-sidebar">
      <div className="crm-brand">
        <img src={appConfig.companyLogo} alt={appConfig.companyName + " logo"} className="crm-brand-logo" />
        <div className="crm-logo">{appConfig.companyName}</div>
      </div>
      <div className="crm-tagline">{appConfig.companyTagline}</div>
      <nav className="crm-nav">
        {modules.filter(function (item) {
          return hasPermission(auth.profile, item.permission);
        }).map(function (item) {
          const active = pathname === item.href;
          return (
            <Link key={item.href} href={item.href} className={active ? "active" : ""}>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
