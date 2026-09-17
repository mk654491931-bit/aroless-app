import { describeAnalysisFailure, SearchErrorCard } from "@/components/search-states";

/**
 * Analiz yüzeylerinde (konsey, mağaza denetimi, kreatif stüdyo, araç kartları)
 * başarısız işlemi ekranda tutan kart.
 *
 * Neden: bu akışlar kredi düşürüyor ve hata yalnızca kaybolan bir toast ile
 * gösteriliyordu; kullanıcı hem hatayı okuyamıyor hem de kredinin iade edilip
 * edilmediğini göremiyordu. Sunucu tarafı artık başarısız analizde krediyi
 * iade ediyor (bkz. credit-guard.server.ts); kart bunu görünür kılar ve
 * "tekrar dene" / "girdiyi değiştir" aksiyonlarını kalıcı verir.
 */
export function AnalysisFailureCard({
  message,
  subject,
  onRetry,
  onEdit,
  retryLabel = "Tekrar dene",
  editLabel = "Girdiyi değiştir",
  creditSafe = true,
}: {
  /** Sunucudan gelen ham hata mesajı (sınıflandırma bu metne göre yapılır). */
  message: string | null | undefined;
  /** Kart başlığının altında gösterilen bağlam (ör. aranan ürün/niş). */
  subject?: string;
  onRetry: () => void;
  onEdit?: () => void;
  retryLabel?: string;
  editLabel?: string;
  creditSafe?: boolean;
}) {
  const failure = describeAnalysisFailure(message);
  return (
    <SearchErrorCard
      error={{ ...failure, ...(subject ? { niche: subject } : {}) }}
      onRetry={onRetry}
      onEdit={onEdit ?? onRetry}
      label="Analiz"
      retryLabel={retryLabel}
      editLabel={editLabel}
      creditSafe={creditSafe}
    />
  );
}
