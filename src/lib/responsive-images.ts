/**
 * Responsive Image Optimization
 * Cihaz türü ve ağ hızına göre resimleri optimize et
 */

import { useMemo, useEffect, useRef } from "react";
import { deviceDetection, networkAwareness } from "./session-persistence";

export interface ResponsiveImageConfig {
  baseSrc: string;
  alt: string;
  sizes?: string;
  widths?: number[];
  formats?: Array<"webp" | "jpg" | "png" | "avif">;
  quality?: number;
  loading?: "eager" | "lazy";
  placeholderSrc?: string;
}

/**
 * Responsive image srcset oluştur
 */
export function generateSrcSet(
  baseSrc: string,
  widths: number[] = [320, 640, 960, 1280],
  formats: Array<"webp" | "jpg" | "png" | "avif"> = ["webp", "jpg"],
  quality: number = 75,
): string {
  const srcset: string[] = [];

  for (const width of widths) {
    for (const format of formats) {
      // CDN/image service API formatı (Cloudflare, ImgIX, etc.)
      const optimized = buildImageUrl(baseSrc, {
        width,
        format,
        quality,
      });

      srcset.push(`${optimized} ${width}w`);
    }
  }

  return srcset.join(", ");
}

/**
 * Resim URL'sini optimize et
 */
interface ImageOptimizationOptions {
  width?: number;
  height?: number;
  quality?: number;
  format?: "webp" | "jpg" | "png" | "avif" | "auto";
  fit?: "cover" | "contain" | "fill" | "inside" | "outside";
  gravity?: "auto" | "center" | "north" | "south" | "east" | "west";
  blur?: number;
  brightness?: number;
  contrast?: number;
}

export function buildImageUrl(src: string, options?: ImageOptimizationOptions): string {
  if (!src || options === undefined) return src;

  // Eğer zaten optimize edilmişse return et
  if (src.includes("?") && src.includes("w=")) return src;

  // URL scheme kontrol et
  if (!src.startsWith("http")) {
    // Local asset - no optimization
    return src;
  }

  // Cloudflare Image Optimization (cf-images.example.com)
  if (src.includes("cdn.") || src.includes("images.")) {
    const params = new URLSearchParams();
    if (options.width) params.append("w", String(options.width));
    if (options.height) params.append("h", String(options.height));
    if (options.quality) params.append("q", String(options.quality));
    if (options.format && options.format !== "auto") params.append("f", options.format);
    if (options.fit) params.append("fit", options.fit);

    const separator = src.includes("?") ? "&" : "?";
    return `${src}${separator}${params.toString()}`;
  }

  // Generic image URL builder
  return src;
}

/**
 * Cihaza uygun resim genişliğini al
 */
export function getResponsiveImageWidth(): number {
  if (typeof window === "undefined") return 1280;

  const devicePixelRatio = window.devicePixelRatio || 1;
  const windowWidth = window.innerWidth;

  // CSS pixel olarak gerçek genişlik
  const actualWidth = windowWidth * devicePixelRatio;

  // En yakın standart genişliği bul
  const widths = [320, 640, 960, 1280, 1600, 1920, 2560];
  return widths.reduce((prev, curr) =>
    Math.abs(curr - actualWidth) < Math.abs(prev - actualWidth) ? curr : prev,
  );
}

/**
 * Ağ hızına göre kaliteyi ayarla
 */
export function getQualityForNetwork(): number {
  const effectiveType = networkAwareness.getEffectiveType();

  switch (effectiveType) {
    case "slow-2g":
    case "2g":
      return 40; // Düşük kalite
    case "3g":
      return 60; // Orta kalite
    case "4g":
      return 75; // İyi kalite
    case "5g":
      return 90; // Yüksek kalite
    default:
      return 75;
  }
}

/**
 * Resim formatı desteğini kontrol et
 */
export function getSupportedImageFormats(): ("webp" | "jpg" | "avif" | "png")[] {
  if (typeof document === "undefined") return ["jpg"];

  const formats: ("webp" | "jpg" | "avif" | "png")[] = ["jpg"];

  // WebP desteği
  const canvas = document.createElement("canvas");
  if (canvas.toDataURL("image/webp").includes("webp")) {
    formats.push("webp");
  }

  // AVIF desteği (modern browsers)
  const img = new Image();
  img.onload = () => formats.push("avif");
  img.onerror = () => {};
  img.src = "data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAG1hdmYAAACNbWV0YQAAAAAAAABkYXRhZQAQAAAAABA=";

  return formats;
}

/**
 * React Hook - Responsive Image
 */
export function useResponsiveImage(config: ResponsiveImageConfig) {
  const { baseSrc, formats = ["webp", "jpg"], widths = [320, 640, 960, 1280], quality } = config;

  const computedQuality = useMemo(() => quality ?? getQualityForNetwork(), [quality]);
  const responsiveWidth = useMemo(() => getResponsiveImageWidth(), []);
  const supportedFormats = useMemo(() => getSupportedImageFormats(), []);

  const srcSet = useMemo(
    () =>
      generateSrcSet(
        baseSrc,
        widths,
        formats.filter((f) => supportedFormats.includes(f)),
        computedQuality,
      ),
    [baseSrc, widths, formats, supportedFormats, computedQuality],
  );

  const src = useMemo(
    () => buildImageUrl(baseSrc, { width: responsiveWidth, quality: computedQuality }),
    [baseSrc, responsiveWidth, computedQuality],
  );

  const sizes = useMemo(
    () =>
      config.sizes ||
      `(max-width: 640px) 100vw,
       (max-width: 1280px) 50vw,
       33vw`,
    [config.sizes],
  );

  return { src, srcSet, sizes, alt: config.alt };
}

/**
 * Image Placeholder - Progressive Loading
 */
export function generatePlaceholder(
  src: string,
  options?: { width?: number; quality?: number },
): string {
  return buildImageUrl(src, {
    width: options?.width ?? 50,
    quality: options?.quality ?? 20,
  });
}

/**
 * React Hook - Lazy Load Image with Placeholder
 */
export function useLazyImageWithPlaceholder(
  src: string,
  placeholder?: string,
): { displaySrc: string; isLoaded: boolean } {
  const [isLoaded, setIsLoaded] = React.useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  const displaySrc = isLoaded ? src : placeholder || generatePlaceholder(src);

  useEffect(() => {
    const img = new Image();

    img.onload = () => {
      setIsLoaded(true);
    };

    img.onerror = () => {
      console.error(`Failed to load image: ${src}`);
      setIsLoaded(true); // Hata durumunda orijinal kaynağı göster
    };

    img.src = src;

    // Görünen eleman lazily load
    if (!imgRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isLoaded) {
          img.src = src;
        }
      },
      { rootMargin: "50px" },
    );

    observer.observe(imgRef.current);

    return () => observer.disconnect();
  }, [src, isLoaded]);

  return { displaySrc, isLoaded };
}

/**
 * Picture Element Helper - Responsive Image Component Data
 */
export interface PictureSourceConfig {
  srcSet: string;
  media?: string;
  type?: string;
}

export function generatePictureConfig(
  baseSrc: string,
  config?: ResponsiveImageConfig,
): PictureSourceConfig[] {
  const quality = config?.quality ?? getQualityForNetwork();
  const widths = config?.widths ?? [320, 640, 960, 1280];

  return [
    {
      type: "image/avif",
      media: "(prefers-color-scheme: light)",
      srcSet: generateSrcSet(baseSrc, widths, ["avif"], quality),
    },
    {
      type: "image/webp",
      srcSet: generateSrcSet(baseSrc, widths, ["webp"], quality),
    },
    {
      type: "image/jpeg",
      srcSet: generateSrcSet(baseSrc, widths, ["jpg"], quality),
    },
  ];
}

/**
 * WebP Fallback Checker
 */
export async function checkWebPSupport(): Promise<boolean> {
  return new Promise((resolve) => {
    const webP = new Image();
    webP.onload = webP.onerror = () => resolve(webP.height === 2);
    webP.src =
      "data:image/webp;base64,UklGRjoAAABXRUJQVlA4IC4AAADwAQCdASoBIAEADsAkJaACdLoAgADw+NhsNAA/AB5//UATw2DwmT6//MATwAA";
  });
}

import React from "react";

/**
 * React Hook - WebP Support
 */
export function useWebPSupport() {
  const [isSupported, setIsSupported] = React.useState(false);

  useEffect(() => {
    checkWebPSupport().then(setIsSupported);
  }, []);

  return isSupported;
}
