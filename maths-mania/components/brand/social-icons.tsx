import * as React from "react";

/**
 * Brand-mark icons for the third-party platforms we link out to.
 *
 * lucide-react removed Facebook / Instagram / YouTube / Twitter from its
 * library in 2024 due to trademark concerns, so we ship these as inline
 * SVGs. They inherit `currentColor`, so the consuming component can tint
 * them with any token (e.g. text-[var(--color-text-muted)]).
 *
 * All icons are rendered on a 24×24 viewBox and stroke/fill use
 * `currentColor`. Sizing is controlled by the className / width / height
 * props on the wrapping span — same DX as Lucide's API.
 */

type IconProps = React.SVGProps<SVGSVGElement> & { className?: string };

const baseProps = {
  xmlns: "http://www.w3.org/2000/svg",
  viewBox: "0 0 24 24",
  fill: "currentColor",
  "aria-hidden": true,
  focusable: false,
  width: 16,
  height: 16,
} as const;

export function YoutubeIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M21.582 7.158a2.506 2.506 0 0 0-1.768-1.768C18.254 5 12 5 12 5s-6.254 0-7.814.39a2.506 2.506 0 0 0-1.768 1.768C2 8.717 2 12 2 12s0 3.283.418 4.842a2.506 2.506 0 0 0 1.768 1.768C5.746 19 12 19 12 19s6.254 0 7.814-.39a2.506 2.506 0 0 0 1.768-1.768C22 15.283 22 12 22 12s0-3.283-.418-4.842ZM10 15.464V8.536L15.92 12 10 15.464Z" />
    </svg>
  );
}

export function InstagramIcon(props: IconProps) {
  return (
    <svg {...baseProps} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function FacebookIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5.02 3.66 9.18 8.44 9.94v-7.03H7.9v-2.91h2.54V9.85c0-2.52 1.49-3.91 3.78-3.91 1.1 0 2.24.2 2.24.2v2.47h-1.26c-1.24 0-1.63.78-1.63 1.57v1.88h2.77l-.44 2.91h-2.33V22c4.78-.76 8.43-4.92 8.43-9.94Z" />
    </svg>
  );
}

export function WhatsappIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.031-.967-.273-.099-.471-.149-.67.15-.198.297-.768.967-.942 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.297-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.371-.272.298-1.04 1.016-1.04 2.479s1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.077 4.487.71.306 1.263.489 1.695.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347Zm-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.999-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26C2.169 6.6 6.585 2.184 12.05 2.184c2.652 0 5.144 1.034 7.018 2.91a9.825 9.825 0 0 1 2.905 7.014c-.003 5.465-4.419 9.881-9.882 9.881Zm8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
    </svg>
  );
}

/**
 * Centralised typed map so we can iterate over socials in the footer/nav.
 */
export const SOCIAL_ICONS = {
  youtube: YoutubeIcon,
  instagram: InstagramIcon,
  facebook: FacebookIcon,
  whatsapp: WhatsappIcon,
} as const;

export type SocialKind = keyof typeof SOCIAL_ICONS;
