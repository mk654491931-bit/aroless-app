import { useEffect, useState } from "react";
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Clapperboard,
  Loader2,
  Sparkles,
  Copy,
  Trash2,
  Wand2,
  Image as ImageIcon,
  Mail,
  FlaskConical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHero } from "@/components/page-hero";
import { useAuth } from "@/hooks/use-auth";
import { getUiLang } from "@/lib/auto-i18n/lang";
import {
  generateCreativeKit,
  listCreativeAssets,
  deleteCreativeAsset,
  type CreativeAssetRow,
} from "@/lib/creative-studio.functions";

export const Route = createFileRoute("/studio")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    product: typeof s["product"] === "string" ? s["product"] : "",
  }),
  head: () => ({
    meta: [
      { title: "Reklam Kreatif Stüdyosu — Aroless" },
      {
        name: "description",
        content:
          "Ürünün için hook, UGC video senaryosu, reklam metinleri, görsel promptları ve A/B test planını tek ekranda üret.",
      },
      { property: "og:title", content: "Reklam Kreatif Stüdyosu — Aroless" },
      {
        property: "og:description",
        content: "Hook, UGC senaryo, reklam metni ve görsel promptu tek tıkla.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: StudioPage,
});

const CHANNELS = ["TikTok", "Instagram Reels", "Meta", "Google", "YouTube Shorts", "Pinterest"];
const TONES = ["energetic", "premium", "friendly", "expert", "humorous", "urgent"];

function copy(text: string) {
  void navigator.clipboard.writeText(text);
  toast.success("Kopyalandı");
}

function KitView({ row }: { row: CreativeAssetRow }) {
  const kit = row.payload;
  return (
    <Tabs defaultValue="hooks" className="mt-4">
      <TabsList className="flex w-full flex-wrap justify-start gap-1 bg-white/5">
        <TabsTrigger value="hooks" className="text-xs">
          <Sparkles size={12} className="mr-1" /> Hook'lar
        </TabsTrigger>
        <TabsTrigger value="ugc" className="text-xs">
          <Clapperboard size={12} className="mr-1" /> UGC senaryo
        </TabsTrigger>
        <TabsTrigger value="ads" className="text-xs">
          <Wand2 size={12} className="mr-1" /> Reklam metni
        </TabsTrigger>
        <TabsTrigger value="visual" className="text-xs">
          <ImageIcon size={12} className="mr-1" /> Görsel promptları
        </TabsTrigger>
        <TabsTrigger value="tests" className="text-xs">
          <FlaskConical size={12} className="mr-1" /> A/B testler
        </TabsTrigger>
        <TabsTrigger value="crm" className="text-xs">
          <Mail size={12} className="mr-1" /> E-posta / SMS
        </TabsTrigger>
      </TabsList>

      <div className="premium-card mt-3 p-4 text-sm">
        <div className="mb-3 rounded-lg border border-white/10 bg-white/5 p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Konumlandırma
          </div>
          <p className="mt-1 text-sm">{kit.positioning}</p>
          <p className="mt-2 text-xs text-muted-foreground">{kit.audience}</p>
        </div>

        <TabsContent value="hooks" className="space-y-2">
          {kit.hooks?.map((h, i) => (
            <div key={i} className="rounded-lg border border-white/10 bg-white/5 p-3">
              <div className="flex items-start justify-between gap-2">
                <Badge
                  variant="outline"
                  className="border-[var(--accent-active)]/30 text-[10px] text-[var(--accent-active)]"
                >
                  {h.angle}
                </Badge>
                <button
                  onClick={() => copy(h.hook)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Copy size={13} />
                </button>
              </div>
              <p className="mt-2 font-semibold">{h.hook}</p>
              <p className="mt-1 text-xs text-muted-foreground">{h.why}</p>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="ugc">
          <div className="mb-2 flex items-center justify-between">
            <div className="font-bold">{kit.ugc_script?.title}</div>
            <Badge variant="outline" className="text-[10px]">
              {kit.ugc_script?.duration_seconds}s
            </Badge>
          </div>
          <div className="space-y-2">
            {kit.ugc_script?.scenes?.map((s, i) => (
              <div
                key={i}
                className="grid gap-2 rounded-lg border border-white/10 bg-white/5 p-3 md:grid-cols-[70px_1fr]"
              >
                <div className="text-xs font-bold text-[var(--accent-active)]">{s.second}s</div>
                <div className="space-y-1 text-xs">
                  <div>
                    <span className="text-muted-foreground">Görsel: </span>
                    {s.visual}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Ses: </span>
                    {s.voiceover}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Yazı: </span>
                    {s.text_overlay}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-lg border border-[var(--profit)]/30 bg-[var(--profit)]/10 p-3 text-xs">
            CTA: {kit.ugc_script?.cta}
          </div>
        </TabsContent>

        <TabsContent value="ads" className="space-y-2">
          {kit.ad_copies?.map((a, i) => (
            <div key={i} className="rounded-lg border border-white/10 bg-white/5 p-3">
              <div className="flex items-center justify-between">
                <Badge variant="outline" className="text-[10px]">
                  {a.platform}
                </Badge>
                <button
                  onClick={() => copy(`${a.headline}\n${a.primary}\n${a.description}\n${a.cta}`)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Copy size={13} />
                </button>
              </div>
              <p className="mt-2 font-semibold">{a.headline}</p>
              <p className="mt-1 whitespace-pre-line text-xs">{a.primary}</p>
              <p className="mt-1 text-xs text-muted-foreground">{a.description}</p>
              <div className="mt-2 inline-flex rounded-md bg-[var(--accent-active)]/15 px-2 py-1 text-[10px] text-[var(--accent-active)]">
                {a.cta}
              </div>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="visual" className="space-y-2">
          {kit.image_prompts?.map((p, i) => (
            <div key={i} className="rounded-lg border border-white/10 bg-white/5 p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold">{p.label}</div>
                <button
                  onClick={() => copy(p.prompt)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Copy size={13} />
                </button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{p.prompt}</p>
            </div>
          ))}
          <div className="flex flex-wrap gap-1 pt-2">
            {kit.hashtags?.map((h, i) => (
              <span
                key={i}
                className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px]"
              >
                {h}
              </span>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="tests" className="space-y-2">
          {kit.ab_tests?.map((t, i) => (
            <div key={i} className="rounded-lg border border-white/10 bg-white/5 p-3 text-xs">
              <div className="font-semibold">{t.hypothesis}</div>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <div className="rounded border border-white/10 p-2">A: {t.variant_a}</div>
                <div className="rounded border border-white/10 p-2">B: {t.variant_b}</div>
              </div>
              <div className="mt-2 text-muted-foreground">Metrik: {t.metric}</div>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="crm">
          <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-xs">
            <div className="font-semibold">{kit.email_sms?.subject}</div>
            <p className="mt-2 whitespace-pre-line">{kit.email_sms?.body}</p>
            <div className="mt-3 rounded border border-white/10 p-2">SMS: {kit.email_sms?.sms}</div>
          </div>
        </TabsContent>
      </div>
    </Tabs>
  );
}

function StudioPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { user, loading } = useAuth();
  const search = useSearch({ from: "/studio" });
  const [product, setProduct] = useState(search.product ?? "");
  const [platform, setPlatform] = useState("TikTok");
  const [audience, setAudience] = useState("");
  const [price, setPrice] = useState("");
  const [tone, setTone] = useState("energetic");
  const [active, setActive] = useState<CreativeAssetRow | null>(null);

  const genFn = useServerFn(generateCreativeKit);
  const listFn = useServerFn(listCreativeAssets);
  const delFn = useServerFn(deleteCreativeAsset);

  useEffect(() => {
    if (!loading && !user) nav({ to: "/auth" });
  }, [user, loading, nav]);

  const history = useQuery({
    queryKey: ["creative-assets"],
    queryFn: () => listFn(),
    enabled: !!user,
  });

  const gen = useMutation({
    mutationFn: () =>
      genFn({ data: { product, platform, audience, price, tone, lang: getUiLang() } }),
    onSuccess: (row) => {
      setActive(row);
      qc.invalidateQueries({ queryKey: ["creative-assets"] });
      qc.invalidateQueries({ queryKey: ["profile"] });
      toast.success("Kreatif paket hazır");
    },
    onError: (e: Error) => toast.error(e.message === "NO_CREDITS" ? "Kredin bitti" : e.message),
  });

  if (loading || !user) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <PageHero
        icon={<Clapperboard size={20} />}
        title="Reklam Kreatif Stüdyosu"
        description="Hook, UGC senaryo, reklam metni, görsel promptu ve A/B test planı — tek ürün, tek tık."
      />

      <Card className="premium-card mb-5 border-white/10">
        <CardContent className="grid gap-3 p-4 md:grid-cols-5">
          <Input
            placeholder="Ürün adı"
            value={product}
            onChange={(e) => setProduct(e.target.value)}
            className="md:col-span-2"
          />
          <Select value={platform} onValueChange={setPlatform}>
            <SelectTrigger className="text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHANNELS.map((c) => (
                <SelectItem key={c} value={c} className="text-xs">
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={tone} onValueChange={setTone}>
            <SelectTrigger className="text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TONES.map((c) => (
                <SelectItem key={c} value={c} className="text-xs">
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={() => gen.mutate()}
            disabled={product.trim().length < 2 || gen.isPending}
          >
            {gen.isPending ? (
              <Loader2 size={14} className="mr-1 animate-spin" />
            ) : (
              <Sparkles size={14} className="mr-1" />
            )}
            Üret (1 kredi)
          </Button>
          <Input
            placeholder="Hedef kitle (opsiyonel)"
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            className="md:col-span-3"
          />
          <Input
            placeholder="Satış fiyatı (opsiyonel)"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="md:col-span-2"
          />
        </CardContent>
      </Card>

      {active && <KitView row={active} />}

      {(history.data?.length ?? 0) > 0 && (
        <div className="mt-6">
          <div className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
            Geçmiş paketler
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            {history.data!.map((row) => (
              <div
                key={row.id}
                className="premium-card flex items-center justify-between gap-2 p-3"
              >
                <button className="min-w-0 flex-1 text-left" onClick={() => setActive(row)}>
                  <div className="truncate text-xs font-semibold">{row.product_name}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {row.platform} · {new Date(row.created_at).toLocaleDateString()}
                  </div>
                </button>
                <button
                  className="text-muted-foreground hover:text-red-400"
                  onClick={async () => {
                    await delFn({ data: { id: row.id } });
                    if (active?.id === row.id) setActive(null);
                    qc.invalidateQueries({ queryKey: ["creative-assets"] });
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
