# 🚀 Performance Optimization Guide

## Genel Optimizasyonlar

Aroless uygulaması aşağıdaki performans optimizasyonları içerir:

### 1. **Vite Build Optimizasyonları** (`vite.config.ts`)
- ✅ **Code Splitting**: React, UI components, TanStack, Supabase vb. kütüphaneleri ayrı chunks'a bölünür
- ✅ **Minification**: Terser ile JavaScript minimize edilir (console logs production'da kaldırılır)
- ✅ **CSS Code Splitting**: Sadece kullanılan CSS yüklenir
- ✅ **Asset Optimization**: Resimler ve fontlar ayrı klasörlere organize edilir
- ✅ **Gzip Compression**: Tüm assets gzip ile sıkıştırılır

### 2. **Router & Preloading** (`src/router.tsx`)
- ✅ **Link Prefetching**: Kullanıcı mouse'u linkin üzerine getirdiğinde (intent) rota önceden yüklenir
- ✅ **Smart Preload Delay**: 50ms delay ile gereksiz prefetch'ler engellenmiş, gereken prefetch'ler yapılır
- ✅ **Scroll Restoration**: Sayfa geçişlerinde scroll konumu otomatik olarak geri yüklenir

### 3. **React Query Optimizasyonları** (`src/router.tsx`)
- ✅ **Stale Time**: Veri 5 dakika geçerli kabul edilir (gereksiz refetch önlenir)
- ✅ **Cache Time**: Cache 30 dakika saklanır
- ✅ **Stale Revalidation**: Bağlantı geri gelirse stale veri sessiz yenilenir
- ✅ **No Refetch on Mount**: Component mount'da tekrar fetch yapılmaz
- ✅ **Retry Strategy**: Başarısız istekler exponential backoff ile retry edilir

### 4. **Mobile Optimizasyonları** (`src/lib/mobile-optimization.ts`)
- ✅ **Viewport Optimization**: Safe area insets (notch/cutout) için doğru viewport ayarları
- ✅ **Touch Performance**: Passive event listeners, touch-action optimizasyonları
- ✅ **Haptic Feedback**: Mobil cihazlarda kullanıcı interaksiyonlarını hissettir
- ✅ **Orientation Management**: Cihaz döndürülünce sayfanın dinamik ayarlanması
- ✅ **Keyboard Management**: Sanal klavye gösterilip gizlendiğini algıla

### 5. **Session Persistence** (`src/lib/session-persistence.ts`)
- ✅ **Local Storage**: Kullanıcı oturumu cihazda saklanır
- ✅ **Cross-Device Sync**: Aynı hesap farklı cihazlarda senkron kalır
- ✅ **Scroll Position Restoration**: Her route'da scroll konumu korunur
- ✅ **IndexedDB Caching**: Büyük veriler IndexedDB'de optimize edilir
- ✅ **Expiry Management**: Cache verisi otomatik olarak expire edilir

### 6. **Network Awareness** (`src/lib/session-persistence.ts`)
- ✅ **Effective Type Detection**: 2G/3G/4G/5G ağ hızını algıla
- ✅ **Offline Support**: Bağlantı koptuğunda sayfanın çalışması devam eder
- ✅ **Data Saver Mode**: Veri tasarrufu modu aktifse düşük kalite kaynaklar yükle
- ✅ **Adaptive Loading**: Ağ hızına göre dinamik olarak kaynak kalitesi ayarla

### 7. **Advanced Performance Monitoring** (`src/lib/advanced-performance.ts`)
- ✅ **Web Vitals**: LCP, FID, CLS, INP, TTFB metrikleri real-time izlenmiş
- ✅ **Long Task Detection**: 50ms üzeri işlemler tespit edilir
- ✅ **Memory Monitoring**: JavaScript heap kullanımı izlenir
- ✅ **Resource Timing**: Her kaynağın yüklenme süresi analiz edilir
- ✅ **Performance Reports**: Tam performans raporları üretilebilir

### 8. **Lazy Loading** (`src/lib/lazy-loading.ts`)
- ✅ **Component Lazy Loading**: Kullanılan bileşenler sadece ihtiyaç halinde yüklenir
- ✅ **Image Lazy Loading**: Intersection Observer ile resimler görünür hale gelmeden yüklenmez
- ✅ **Intersection Observer**: Scroll performansını optimize eden IntersectionObserver kullanımı
- ✅ **Virtual Scrolling**: Büyük listelerde sadece görünür öğeler render edilir
- ✅ **Script on Demand**: Harici scriptler kullanıldığında dinamik yüklenir

### 9. **Responsive Images** (`src/lib/responsive-images.ts`)
- ✅ **Adaptive Sizing**: Cihaz genişliğine göre doğru boyutta resim yüklenir
- ✅ **Format Selection**: WebP/AVIF gibi modern formatlar destekleniyorsa otomatik kullanılır
- ✅ **Quality Adjustment**: Ağ hızına göre kalite otomatik ayarlanır
- ✅ **Lazy Loading**: Resimler görünür olmadan yüklenmez
- ✅ **Progressive Loading**: Düşük kalite placeholder → yüksek kalite (LQIP pattern)

### 10. **Device Detection** (`src/lib/session-persistence.ts`)
- ✅ **Mobile Detection**: Mobil/tablet/desktop otomatik algılanır
- ✅ **Touch Detection**: Touch cihaz olup olmadığı tespit edilir
- ✅ **Pixel Ratio**: Retina/high-DPI displayler için uygun assets seçilir
- ✅ **Dark Mode**: Sistem dark mode tercihine göre tema ayarlanır
- ✅ **Prefersation Support**: Açıkça kullanıcı tercihlerine uyulur

---

## Başlangıç - Performance Init

Tüm optimizasyonlar otomatik olarak uygulamada başlatılır:

```typescript
// src/routes/__root.tsx
usePerformanceInit({
  enableWebVitals: true,
  enableSessionPersistence: true,
  enableMobileOptimizations: true,
  enableNetworkAwareness: true,
  debug: process.env.NODE_ENV === "development",
});
```

---

## Kullanılan Hooks

### Session & Persistence
```typescript
// Oturumu yönet
const { session, isLoaded, saveSession } = useSession();

// Network bilgisi al
const { isOnline, effectiveType, isSlowNetwork } = useNetworkAwareness();

// Cihaz bilgisi al
const { deviceType, isTouch, isDarkMode, dataSaver } = useDeviceDetection();
```

### Performance Monitoring
```typescript
// Web Vitals izle
const { metrics, resourceMetrics, memoryMetrics } = useWebVitalsMonitoring();

// Performans raporu oluştur
const report = await generatePerformanceReport();
```

### Mobile Optimization
```typescript
// Mobile optimizasyonları başlat
useMobileOptimization();

// Orientation takibi
const { orientation, isPortrait, isLandscape } = useOrientation();

// Keyboard yüksekliğini takip et
const { keyboardHeight, isKeyboardVisible } = useKeyboardHeight();

// Gesture detection (swipe, pinch)
const elementRef = useGestureDetector(onSwipe, onPinch);
```

### Images
```typescript
// Responsive resim
const { src, srcSet, sizes } = useResponsiveImage({
  baseSrc: "image.jpg",
  alt: "Description",
  widths: [320, 640, 960, 1280],
});

// Lazy loading + placeholder
const { displaySrc, isLoaded } = useLazyImageWithPlaceholder(
  "high-quality.jpg",
  "placeholder.jpg"
);
```

---

## Best Practices

### 1. **Component Lazy Loading**
```typescript
const HeavyComponent = lazy(() => import("./HeavyComponent"));

export function MyComponent() {
  return (
    <Suspense fallback={<Loading />}>
      <HeavyComponent />
    </Suspense>
  );
}
```

### 2. **Network-Aware Loading**
```typescript
function ImageComponent() {
  const { isSlowNetwork } = useNetworkAwareness();

  return (
    <img
      src={isSlowNetwork ? "low-quality.jpg" : "high-quality.jpg"}
      alt="..."
    />
  );
}
```

### 3. **Session Preservation**
```typescript
function MyComponent() {
  const { session, saveSession } = useSession();

  useEffect(() => {
    // Sayfa kapanırken durumu kaydet
    return () => {
      saveSession({ lastRoute: location.pathname });
    };
  }, [saveSession]);

  return <div>Content</div>;
}
```

### 4. **Responsive Images**
```typescript
function ResponsiveImage() {
  const { src, srcSet, sizes } = useResponsiveImage({
    baseSrc: "image.jpg",
    alt: "Product",
  });

  return (
    <img src={src} srcSet={srcSet} sizes={sizes} alt="Product" />
  );
}
```

---

## Development Tips

### 1. **Performance Debugging**
```bash
# Development modunda verbose logging'i açık
# Otomatik olarak console'a performans metrikleri yazılır
npm run dev
```

### 2. **Performance Report**
```typescript
const report = await generatePerformanceReport({
  includeResources: true,
  includeMemory: true,
});
console.log(report);
```

### 3. **Performance Hints**
```typescript
const hints = await getPerformanceHints();
console.log("Performance hints:", hints);
```

### 4. **Chrome DevTools**
- Lighthouse: Build performansını kontrol et
- Network: Bağlantı hızı simülasyonu yaparak test et
- Performance: User interactions sırasında performansı profil et

---

## Production Deployment

### 1. **Build Optimization**
```bash
npm run build
```

Production build'de otomatik olarak:
- Tüm console.log çıkarılır
- Debugger statements kaldırılır
- CSS minified edilir
- JavaScript tree-shaked edilir

### 2. **Serve Optimization**
- Gzip/Brotli compression etkinleştirilir
- Cache headers doğru ayarlanır
- Service Worker yapılandırılır (opsiyonel)

### 3. **Monitoring**
Performance metrics'i production'da izlenmek için:
```typescript
usePerformanceInit({
  onMetric: (metric) => {
    // Analytics service'e gönder
    analytics.trackWebVital(metric);
  },
});
```

---

## Metrics & Goals

### Web Vitals Targets
- **LCP (Largest Contentful Paint)**: < 2.5s ✅
- **FID (First Input Delay)**: < 100ms ✅
- **CLS (Cumulative Layout Shift)**: < 0.1 ✅
- **INP (Interaction to Next Paint)**: < 200ms ✅
- **TTFB (Time to First Byte)**: < 600ms ✅

### Bundle Metrics
- Main bundle: < 300KB (gzipped)
- Per route: < 100KB (gzipped)
- Total: < 1.5MB (gzipped)

### Caching
- Static assets: 1 yıl cache
- HTML: No-cache (but revalidate)
- API responses: 5 dakika stale time

---

## Troubleshooting

### Ağır sayfa yüklemesi
1. Network tab'ında kaynaları kontrol et
2. Performance monitoring hook'u ile metrikleri kontrol et
3. Code splitting ayarlarını kontrol et

### Yüksek memory usage
1. useWebVitalsMonitoring hook'u ile memory metrikleri kontrol et
2. Büyük state'leri memoize et
3. Virtual scrolling kullan

### Mobil performans sorunları
1. useMobileOptimization hook'unu kullan
2. Ağ hızını simulate et (Chrome DevTools)
3. Touch gestures'ı optimize et

---

## İlgili Dosyalar

- `vite.config.ts` - Build configuration
- `src/router.tsx` - Router optimizations
- `src/lib/performance.ts` - Query optimizations
- `src/lib/performance-init.ts` - Main initialization
- `src/lib/session-persistence.ts` - State management
- `src/lib/mobile-optimization.ts` - Mobile UX
- `src/lib/advanced-performance.ts` - Monitoring
- `src/lib/lazy-loading.ts` - Code splitting
- `src/lib/responsive-images.ts` - Image optimization
