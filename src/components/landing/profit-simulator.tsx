import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, CheckCircle2, RotateCcw } from "lucide-react";

const DEFAULTS = {
  price: 499,
  cost: 184,
  shipping: 42,
  commission: 18,
};

function formatTry(value: number) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

/**
 * Landing için etkileşimli kâr simülatörü.
 *
 * Amaç yalnız “hesap makinesi” göstermek değil: ziyaretçi kendi fiyat/maliyet
 * girdisini 10 saniyede deneyip ürün kararının gerçek ekonomiyle bağını görür.
 * Sonuç bir örnek simülasyondur; KDV/iade/reklam riski raporda ayrıca modellenir.
 */
export function ProfitSimulator() {
  const [price, setPrice] = useState(DEFAULTS.price);
  const [cost, setCost] = useState(DEFAULTS.cost);
  const [shipping, setShipping] = useState(DEFAULTS.shipping);
  const [commission, setCommission] = useState(DEFAULTS.commission);

  const calc = useMemo(() => {
    const commissionFee = (price * commission) / 100;
    const totalCost = cost + shipping + commissionFee;
    const net = price - totalCost;
    const margin = price > 0 ? (net / price) * 100 : 0;
    const status = margin >= 25 ? "good" : margin >= 10 ? "watch" : "risk";
    return { commissionFee, totalCost, net, margin, status };
  }, [price, cost, shipping, commission]);

  const statusLabel =
    calc.status === "good"
      ? "Sağlıklı marj"
      : calc.status === "watch"
        ? "Sınırda marj"
        : "Riskli marj";
  const StatusIcon =
    calc.status === "good" ? CheckCircle2 : calc.status === "watch" ? AlertTriangle : AlertTriangle;

  const reset = () => {
    setPrice(DEFAULTS.price);
    setCost(DEFAULTS.cost);
    setShipping(DEFAULTS.shipping);
    setCommission(DEFAULTS.commission);
  };

  return (
    <div className="al-sim">
      <div className="al-sim-head">
        <div>
          <p className="al-sim-kicker">Örnek simülasyon</p>
          <h3>Bir ürünün gerçek kârını 10 saniyede gör.</h3>
        </div>
        <button type="button" onClick={reset} className="al-sim-reset">
          <RotateCcw size={12} /> Sıfırla
        </button>
      </div>

      <div className="al-sim-body">
        <div className="al-sim-controls">
          <SimField
            label="Satış fiyatı"
            value={price}
            min={50}
            max={3000}
            step={10}
            onChange={setPrice}
          />
          <SimField
            label="Ürün maliyeti"
            value={cost}
            min={0}
            max={2000}
            step={5}
            onChange={setCost}
          />
          <SimField
            label="Kargo + paketleme"
            value={shipping}
            min={0}
            max={500}
            step={5}
            onChange={setShipping}
          />
          <SimField
            label="Pazar yeri komisyonu"
            value={commission}
            min={0}
            max={40}
            step={1}
            onChange={setCommission}
            suffix="%"
          />
        </div>

        <div className={`al-sim-result al-sim-result-${calc.status}`} aria-live="polite">
          <div className="al-sim-result-head">
            <span>Net kâr</span>
            <span className="al-sim-status">
              <StatusIcon size={12} />
              {statusLabel}
            </span>
          </div>
          <strong className="al-sim-net">{formatTry(calc.net)}</strong>

          <div className="al-sim-margin">
            <span>Net marj</span>
            <b>{calc.margin.toFixed(1)}%</b>
          </div>
          <div className="al-sim-bar" aria-hidden="true">
            <span style={{ width: `${Math.max(0, Math.min(100, calc.margin))}%` }} />
          </div>

          <dl className="al-sim-breakdown">
            <div>
              <dt>Komisyon</dt>
              <dd>{formatTry(calc.commissionFee)}</dd>
            </div>
            <div>
              <dt>Toplam maliyet</dt>
              <dd>{formatTry(calc.totalCost)}</dd>
            </div>
          </dl>

          <p className="al-sim-note">
            Basit marj simülasyonu. KDV, iade ve reklam riski Aroless raporunda ayrıca modellenir.
          </p>

          <Link to="/auth" search={{ mode: "signup" }} className="al-sim-cta">
            Bu hesabı ürünlerim için otomatikleştir
            <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </div>
  );
}

function SimField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  suffix = "₺",
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  suffix?: string;
}) {
  const display = suffix === "%" ? `${value}%` : `${value.toLocaleString("tr-TR")} ${suffix}`;
  return (
    <label className="al-sim-field">
      <span className="al-sim-label">
        <span>{label}</span>
        <b>{display}</b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
        className="al-sim-range"
      />
    </label>
  );
}
