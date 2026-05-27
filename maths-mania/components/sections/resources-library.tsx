"use client";

import * as React from "react";
import { FileText, Download } from "lucide-react";
import { LeadGate } from "@/components/sections/lead-gate";
import {
  RESOURCE_CATEGORIES,
  filterResources,
  type ResourceCategory,
  type ResourceItem,
} from "@/lib/resources";
import { cn } from "@/lib/utils";

type ResourcesLibraryProps = {
  initialCategory?: ResourceCategory | "all";
};

export function ResourcesLibrary({
  initialCategory = "all",
}: ResourcesLibraryProps) {
  const [category, setCategory] = React.useState<ResourceCategory | "all">(
    initialCategory,
  );
  const [gateResource, setGateResource] = React.useState<ResourceItem | null>(
    null,
  );
  const [gateOpen, setGateOpen] = React.useState(false);

  const resources = filterResources(category);

  function triggerDownload(resource: ResourceItem) {
    const link = document.createElement("a");
    link.href = resource.fileUrl;
    link.download = resource.fileName;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function handleDownloadClick(resource: ResourceItem) {
    setGateResource(resource);
    setGateOpen(true);
  }

  return (
    <>
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label="Filter by category"
      >
        {RESOURCE_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => setCategory(cat.id)}
            aria-pressed={category === cat.id}
            className={cn(
              "rounded-full px-4 py-2 text-sm font-semibold transition-colors",
              category === cat.id
                ? "bg-[var(--color-primary-500)] text-white"
                : "bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
            )}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {resources.length === 0 ? (
        <p className="mt-12 text-center text-[var(--color-text-muted)]">
          No resources in this category yet.
        </p>
      ) : (
        <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {resources.map((resource) => (
            <li key={resource.id}>
              <article className="flex h-full flex-col rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-soft)] transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)]">
                <div className="flex flex-1 flex-col p-5">
                  <span className="inline-flex size-12 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary-50)] text-[var(--color-primary-600)] dark:bg-[var(--color-primary-900)]/30">
                    <FileText className="size-6" aria-hidden />
                  </span>
                  <h2 className="mt-4 font-semibold text-[var(--color-text)]">
                    {resource.title}
                  </h2>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-[var(--color-text-muted)]">
                    {resource.description}
                  </p>
                  <p className="mt-3 font-mono text-xs text-[var(--color-text-faint)]">
                    {resource.pages} pages · {resource.sizeLabel}
                  </p>
                </div>
                <div className="border-t border-[var(--color-border)] p-4">
                  <button
                    type="button"
                    onClick={() => handleDownloadClick(resource)}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[var(--color-primary-500)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--color-primary-600)]"
                  >
                    <Download className="size-4" aria-hidden />
                    Download free
                  </button>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}

      <LeadGate
        resource={gateResource}
        open={gateOpen}
        onOpenChange={setGateOpen}
        onDownload={triggerDownload}
      />
    </>
  );
}
