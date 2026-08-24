import { useState } from "react";
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

export type LegalConsent = { terms: boolean; kvkk: boolean; marketing: boolean };

export function SignupLegalConsent({
  value,
  onChange,
}: {
  value: LegalConsent;
  onChange: (v: LegalConsent) => void;
}) {
  const [doc, setDoc] = useState<LegalDoc | null>(null);

  const openDoc = (d: LegalDoc) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDoc(d);
  };

  const linkCls =
    "font-medium text-foreground underline underline-offset-2 hover:text-[var(--brand,var(--primary))]";

  return (
    <div className="space-y-2.5 rounded-xl border border-border bg-card/40 p-3">
      <label className="flex cursor-pointer items-start gap-2.5 text-[11px] leading-relaxed text-muted-foreground">
        <Checkbox
          checked={value.terms}
          onCheckedChange={(c) => onChange({ ...value, terms: c === true })}
          className="mt-0.5"
        />
        <span>
          Aroless{" "}
          <a href="/legal/kullanim-kosullari" onClick={openDoc(TOS)} className={linkCls}>
            Kullanım Koşulları
          </a>{" "}
          ve{" "}
          <a href="/legal/veri-isleme-sozlesmesi" onClick={openDoc(DPA)} className={linkCls}>
            Veri İşleme Sözleşmesi
          </a>
          'ni okudum, kabul ediyorum.
        </span>
      </label>

      <label className="flex cursor-pointer items-start gap-2.5 text-[11px] leading-relaxed text-muted-foreground">
        <Checkbox
          checked={value.kvkk}
          onCheckedChange={(c) => onChange({ ...value, kvkk: c === true })}
          className="mt-0.5"
        />
        <span>
          Kişisel verilerimin işlenmesine ilişkin{" "}
          <a href="/legal/kvkk-aydinlatma-metni" onClick={openDoc(KVKK)} className={linkCls}>
            KVKK Aydınlatma Metni
          </a>
          'ni okudum.
        </span>
      </label>

      <label className="flex cursor-pointer items-start gap-2.5 text-[11px] leading-relaxed text-muted-foreground">
        <Checkbox
          checked={value.marketing}
          onCheckedChange={(c) => onChange({ ...value, marketing: c === true })}
          className="mt-0.5"
        />
        <span>
          Aroless ürün güncellemeleri, kampanya ve ticari elektronik iletiler almayı onaylıyorum.{" "}
          <span className="text-muted-foreground/70">(İsteğe bağlı)</span>
        </span>
      </label>

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
