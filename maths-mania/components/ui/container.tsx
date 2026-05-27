import * as React from "react";
import { cn } from "@/lib/utils";

type ContainerProps = React.HTMLAttributes<HTMLDivElement> & {
  /** Maximum width preset. Default is the standard 7xl. */
  size?: "sm" | "md" | "lg" | "xl" | "default" | "wide" | "full";
  as?: "div" | "section" | "main" | "header" | "footer" | "nav" | "article";
};

const SIZE_CLASS: Record<NonNullable<ContainerProps["size"]>, string> = {
  sm: "max-w-3xl",
  md: "max-w-4xl",
  lg: "max-w-5xl",
  xl: "max-w-6xl",
  default: "max-w-7xl",
  wide: "max-w-[88rem]",
  full: "max-w-none",
};

/**
 * Container — central horizontal padding + max-width primitive.
 * Replaces the repeating Tailwind soup `max-w-7xl mx-auto px-4 sm:px-6 lg:px-8`.
 */
export function Container({
  as: As = "div",
  size = "default",
  className,
  children,
  ...rest
}: ContainerProps) {
  return (
    <As
      className={cn(
        "mx-auto w-full px-4 sm:px-6 lg:px-8",
        SIZE_CLASS[size],
        className,
      )}
      {...rest}
    >
      {children}
    </As>
  );
}
