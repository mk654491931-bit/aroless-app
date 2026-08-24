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
    <Link to={linkTo} className="group flex select-none items-center gap-2.5">
      <img
        src="/logo-mark.png"
        alt="Aroless"
        width={72}
        height={72}
        className="shrink-0 object-contain drop-shadow-[0_4px_18px_oklch(0.62_0.19_290/0.5)] transition-transform duration-500 group-hover:scale-[1.06]"
        style={{ height: h, width: h }}
      />
      <span className="leading-none">
        <span
          className="block font-light uppercase text-foreground/95"
          style={{ fontSize: size === "sm" ? 15 : 19, letterSpacing: "0.3em" }}
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
