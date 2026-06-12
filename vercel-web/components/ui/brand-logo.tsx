"use client";

import Image from "next/image";

/**
 * Company logo — uses next/image with `unoptimized` for data: URIs and
 * remote Supabase signed URLs (dynamic hostnames).
 */
export function BrandLogo({
  src,
  alt,
  className,
  width = 160,
  height = 48,
  priority = false
}: {
  src?: string | null;
  alt?: string;
  className?: string;
  width?: number;
  height?: number;
  priority?: boolean;
}) {
  if (!src) return null;
  const remote =
    typeof src === "string" && (src.startsWith("http://") || src.startsWith("https://"));
  const dataUri = typeof src === "string" && src.startsWith("data:");
  return (
    <Image
      src={src}
      alt={alt || ""}
      className={className}
      width={width}
      height={height}
      priority={priority}
      unoptimized={dataUri || remote}
      style={{ width: "auto", height: "auto", maxWidth: "100%", maxHeight: height }}
    />
  );
}
