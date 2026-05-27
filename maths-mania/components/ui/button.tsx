import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold",
    "rounded-full select-none",
    "transition-[background-color,color,border-color,transform,box-shadow]",
    "duration-[var(--duration-base)] ease-[var(--ease-out-quad)]",
    "disabled:pointer-events-none disabled:opacity-50",
    "focus-visible:outline-none",
    "active:scale-[0.98]",
  ].join(" "),
  {
    variants: {
      variant: {
        primary: [
          "bg-[var(--color-primary-500)] text-white",
          "shadow-[var(--shadow-pop)]",
          "hover:bg-[var(--color-primary-600)] hover:shadow-[var(--shadow-card)]",
        ].join(" "),
        secondary: [
          "bg-[var(--color-neutral-900)] text-[var(--color-neutral-50)]",
          "hover:bg-[var(--color-neutral-800)]",
        ].join(" "),
        outline: [
          "border border-[var(--color-border-strong)] bg-transparent text-[var(--color-text)]",
          "hover:bg-[var(--color-surface-alt)] hover:border-[var(--color-text)]",
        ].join(" "),
        ghost: [
          "bg-transparent text-[var(--color-text)]",
          "hover:bg-[var(--color-surface-alt)]",
        ].join(" "),
        link: [
          "rounded-none px-0 text-[var(--color-primary-600)] underline-offset-4",
          "hover:underline",
        ].join(" "),
        destructive: [
          "bg-[var(--color-error)] text-white",
          "hover:opacity-90",
        ].join(" "),
      },
      size: {
        sm: "h-9 px-4 text-sm",
        md: "h-11 px-5 text-sm",
        lg: "h-12 px-6 text-base",
        xl: "h-14 px-8 text-base",
        icon: "h-10 w-10 p-0",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    /** Render as a child element (e.g. an <a> tag) instead of <button>. */
    asChild?: boolean;
  };

/**
 * Button — primary interactive primitive. Supports all standard variants
 * + a tasteful primary CTA with the brand red shadow-pop.
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button({ className, variant, size, asChild, ...props }, ref) {
    const classes = cn(buttonVariants({ variant, size }), className);

    if (asChild && React.isValidElement(props.children)) {
      // Compose with the child element (typically Next's <Link>).
      const child = props.children as React.ReactElement<{
        className?: string;
      }>;
      return React.cloneElement(child, {
        className: cn(classes, child.props.className),
      });
    }

    return <button ref={ref} className={classes} {...props} />;
  },
);

export { buttonVariants };
