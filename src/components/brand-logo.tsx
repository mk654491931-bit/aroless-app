import { Link } from "@tanstack/react-router";

type Props = {
  subtitle?: string;
  linkTo?: string;
  size?: "sm" | "md";
};

/**
 * Aroless identity: the "V" mark artwork paired with an elegant,
 * wide-tracked wordmark and "AI Commerce OS" tagline.
 */
export function BrandLogo({ subtitle = "AI Commerce OS", linkTo = "/", size = "md" }: Props) {
  const h = size === "sm" ? 28 : 36;
  return (
    <Link
      to={linkTo}
      className="group flex shrink-0 select-none items-center gap-2.5 whitespace-nowrap"
    >
      <img
        src="/logo-mark.png"
        alt="Aroless"
        width={72}
        height={72}
        className="shrink-0 object-contain drop-shadow-[0_4px_18px_color-mix(in_oklab,var(--brand)_50%,transparent)] transition-transform duration-500 group-hover:scale-[1.06]"
        style={{ height: h, width: h }}
      />
      <span className="leading-none">
        <span
          className="block font-light uppercase tracking-[0.16em] text-foreground/95 sm:tracking-[0.3em]"
          style={{ fontSize: size === "sm" ? 15 : 19 }}
        >
          Aroless
        </span>
        {subtitle && (
          <span className="mt-1.5 hidden sm:block text-[8px] font-medium uppercase tracking-[0.34em] text-[var(--brand)]">
            {subtitle}
          </span>
        )}
      </span>
    </Link>
  );
}
