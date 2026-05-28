import Link from "next/link";
import { breadcrumbListSchema, type BreadcrumbItem } from "@/lib/seo";
import { JsonLd } from "@/components/seo/json-ld";
import { cn } from "@/lib/utils";

export function Breadcrumbs({
  items,
  className,
}: {
  items: BreadcrumbItem[];
  className?: string;
}) {
  if (items.length === 0) return null;

  return (
    <>
      <JsonLd data={breadcrumbListSchema(items)} />
      <nav aria-label="Breadcrumb" className={cn("text-sm", className)}>
        <ol className="flex flex-wrap items-center gap-1.5 text-[var(--color-text-muted)]">
          {items.map((item, index) => {
            const isLast = index === items.length - 1;
            return (
              <li key={`${item.name}-${index}`} className="flex items-center gap-1.5">
                {index > 0 && (
                  <span className="text-[var(--color-text-faint)]" aria-hidden>
                    /
                  </span>
                )}
                {item.href && !isLast ? (
                  <Link
                    href={item.href}
                    className="font-medium text-[var(--color-primary-600)] hover:underline"
                  >
                    {item.name}
                  </Link>
                ) : (
                  <span
                    className={cn(
                      isLast && "font-medium text-[var(--color-text)]",
                    )}
                    aria-current={isLast ? "page" : undefined}
                  >
                    {item.name}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
    </>
  );
}
