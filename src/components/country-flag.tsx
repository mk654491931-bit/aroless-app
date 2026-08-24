import { useCountryMeta, currencySymbol } from "@/lib/rest-countries";
import { countryByCode } from "@/lib/countries";

/** Flag rendered from the free RestCountries SVG, with emoji fallback. */
export function CountryFlag({
  code,
  size = 16,
  className = "",
}: {
  code: string;
  size?: number;
  className?: string;
}) {
  const meta = useCountryMeta(code);
  const c = countryByCode(code);
  if (!meta.flagSvg)
    return (
      <span className={className} style={{ fontSize: size }}>
        {c.flag}
      </span>
    );
  return (
    <img
      src={meta.flagSvg}
      alt={`${c.name} bayrağı`}
      loading="lazy"
      width={size * 1.4}
      height={size}
      className={`inline-block rounded-[2px] object-cover align-[-2px] ring-1 ring-white/10 ${className}`}
      style={{ width: size * 1.4, height: size }}
    />
  );
}

/** Flag + live currency code/symbol badge (RestCountries). */
export function CountryCurrencyBadge({ code }: { code: string }) {
  const meta = useCountryMeta(code);
  const cur = meta.currency || countryByCode(code).currency;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-muted-foreground">
      <CountryFlag code={code} size={11} />
      {cur} {meta.currencySymbol || currencySymbol(cur)}
    </span>
  );
}
