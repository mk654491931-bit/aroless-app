import { useState, type ReactElement, type ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { LegalDocBody } from "@/components/legal/legal-doc-body";
import { TOS, KVKK, DPA, type LegalDoc } from "@/lib/legal-content";
import {
  applyConsent,
  toggleConsent,
  type ConsentKey,
  type LegalConsent,
} from "@/lib/signup-consent";

/**
 * Kayıt formunun yasal onay bloğu.
 *
 * Kutular tıklamayı tek yerde toplar: kutu `<label>` içine **alınmaz**, etiket
 * `htmlFor` ile bağlanır ve tıklama `preventDefault()` ile tarayıcının kendi
 * iletimine bırakılmaz. Böylece mobilde (özellikle iOS Safari, `<button>`
 * öğesine etiket tıklamasını iletmez) onay kutusu ya hiç işaretlenmiyor ya da
 * iki kez çevriliyordu; kullanıcı da zorunlu onay hatasını tekrar tekrar
 * görüyordu.
 */
export function SignupLegalConsent({
  value,
  onChange,
}: {
  value: LegalConsent;
  onChange: (v: LegalConsent) => void;
}): ReactElement {
  const [doc, setDoc] = useState<LegalDoc | null>(null);

  const openDoc = (d: LegalDoc) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDoc(d);
  };

  const linkCls =
    "font-medium text-foreground underline underline-offset-2 hover:text-[var(--brand,var(--primary))]";

  const row = (key: ConsentKey, id: string, text: ReactNode) => (
    <div className="flex items-start gap-2.5 text-[11px] leading-relaxed text-muted-foreground">
      <Checkbox
        id={id}
        checked={value[key]}
        onCheckedChange={(c) => onChange(applyConsent(value, key, c === true))}
        className="mt-0.5"
      />
      <label
        htmlFor={id}
        onClick={(e) => {
          // Varsayılan etiket davranışı kapatılır: tek tıklama = tek çevirme.
          e.preventDefault();
          onChange(toggleConsent(value, key));
        }}
        className="cursor-pointer"
      >
        {text}
      </label>
    </div>
  );

  return (
    <div className="space-y-2.5 rounded-xl border border-border bg-card/40 p-3">
      {row(
        "terms",
        "aroless-consent-terms",
        <>
          Aroless{" "}
          <a href="/legal/kullanim-kosullari" onClick={openDoc(TOS)} className={linkCls}>
            Kullanım Koşulları
          </a>{" "}
          ve{" "}
          <a href="/legal/veri-isleme-sozlesmesi" onClick={openDoc(DPA)} className={linkCls}>
            Veri İşleme Sözleşmesi
          </a>
          'ni okudum, kabul ediyorum.
        </>,
      )}

      {row(
        "kvkk",
        "aroless-consent-kvkk",
        <>
          Kişisel verilerimin işlenmesine ilişkin{" "}
          <a href="/legal/kvkk-aydinlatma-metni" onClick={openDoc(KVKK)} className={linkCls}>
            KVKK Aydınlatma Metni
          </a>
          'ni okudum.
        </>,
      )}

      {row(
        "marketing",
        "aroless-consent-marketing",
        <>
          Aroless ürün güncellemeleri, kampanya ve ticari elektronik iletiler almayı onaylıyorum.{" "}
          <span className="text-muted-foreground/70">(İsteğe bağlı)</span>
        </>,
      )}

      <Sheet open={doc !== null} onOpenChange={(o) => !o && setDoc(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          {doc && (
            <>
              <SheetHeader>
                <SheetTitle>{doc.title}</SheetTitle>
                <SheetDescription>Son Güncelleme: {doc.updated}</SheetDescription>
              </SheetHeader>
              <div className="px-4 pb-8">
                <LegalDocBody doc={doc} compact />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
