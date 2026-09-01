/**
 * Advanced Image Lazy Loading & Optimization
 * WebP/AVIF format support, responsive images, LQIP
 */

import { useEffect, useRef, useState } from "react";

interface ImageOptimizationOptions {
  srcSet?: boolean;
  formats?: ("webp" | "avif" | "jpg" | "png")[];
  lazy?: boolean;
  blur?: boolean;
  fallbackColor?: string;
  quality?: number;
  networkAware?: boolean;
}

const defaultOptions: ImageOptimizationOptions = {
  srcSet: true,
  formats: ["avif", "webp", "jpg"],
  lazy: true,
  blur: true,
  quality: 75,
  networkAware: true,
};

/**
 * Generate responsive image srcset based on device
 */
export function generateResponsiveSrcSet(
  imagePath: string,
  widths: number[] = [320, 640, 1024, 1920],
  format: "webp" | "avif" | "jpg" = "webp"
): string {
  return widths
    .map((width) => {
      // Format conversion
      const ext = format;
      const imageName = imagePath.split(".")[0];
      return `${imageName}-${width}w.${ext} ${width}w`;
    })
    .join(", ");
}

/**
 * Picture element with format fallbacks
 */
export function createPictureElement(
  imagePath: string,
  alt: string,
  options = defaultOptions
): string {
  const formats = options.formats || ["avif", "webp", "jpg"];
  const quality = options.quality || 75;

  let pictureHTML = "<picture>";

  // AVIF source
  if (formats.includes("avif")) {
    pictureHTML += `<source srcset="${generateResponsiveSrcSet(imagePath, undefined, "avif")}" type="image/avif">`;
  }

  // WebP source
  if (formats.includes("webp")) {
    pictureHTML += `<source srcset="${generateResponsiveSrcSet(imagePath, undefined, "webp")}" type="image/webp">`;
  }

  // JPG fallback
  pictureHTML += `<img src="${imagePath}" alt="${alt}" loading="lazy" />`;
  pictureHTML += "</picture>";

  return pictureHTML;
}

/**
 * Image component with lazy loading intersection observer
 */
export function useImageLazyLoading(
  ref: React.RefObject<HTMLImageElement>,
  options = defaultOptions
) {
  const [isLoaded, setIsLoaded] = useState(!options.lazy);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    if (!options.lazy || !ref.current) {
      setIsLoaded(true);
      return;
    }

    const observerOptions: IntersectionObserverInit = {
      root: null,
      rootMargin: "50px",
      threshold: 0.01,
    };

    observerRef.current = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setIsLoaded(true);
        observerRef.current?.unobserve(entry.target);
      }
    }, observerOptions);

    observerRef.current.observe(ref.current);

    return () => {
      observerRef.current?.disconnect();
    };
  }, [ref, options.lazy]);

  return isLoaded;
}

/**
 * Blur hash generation for LQIP (Low Quality Image Placeholder)
 */
export function generateBlurHash(color: string = "#e5e5e5"): string {
  return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'%3E%3Crect fill='${encodeURIComponent(color)}' width='1' height='1'/%3E%3C/svg%3E`;
}

/**
 * Network-aware quality adjustment
 */
export function getNetworkAwareQuality(
  baseQuality: number = 75
): number {
  if (typeof navigator === "undefined" || !(navigator as any).connection) {
    return baseQuality;
  }

  const connection = (navigator as any).connection;
  const effectiveType = connection.effectiveType;
  const saveData = connection.saveData;

  if (saveData) return baseQuality * 0.6; // Data saver mode
  if (effectiveType === "slow-2g" || effectiveType === "2g") return baseQuality * 0.5;
  if (effectiveType === "3g") return baseQuality * 0.7;
  if (effectiveType === "4g") return baseQuality;
  if (effectiveType === "5g") return Math.min(baseQuality * 1.2, 95);

  return baseQuality;
}

/**
 * Batch image preloading
 */
export function preloadImages(urls: string[]): Promise<any[]> {
  return Promise.all(
    urls.map(
      (url) =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error(`Failed to load ${url}`));
          img.src = url;
        })
    )
  );
}

/**
 * Image optimization cache
 */
class ImageCache {
  private cache = new Map<string, string>();
  private maxSize = 100;

  set(key: string, value: string) {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  get(key: string): string | undefined {
    return this.cache.get(key);
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  clear() {
    this.cache.clear();
  }
}

export const imageCache = new ImageCache();

/**
 * Advanced image observer - Batch loading ve priority
 */
export class ImageObserver {
  private observer: IntersectionObserver;
  private loadingQueue: Set<HTMLImageElement> = new Set();
  private maxConcurrent = 4;
  private loading = 0;

  constructor() {
    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            this.queueImageLoad(entry.target as HTMLImageElement);
          } else {
            // Görünmez olduğunda queue'dan çıkar
            this.loadingQueue.delete(entry.target as HTMLImageElement);
          }
        });
      },
      {
        rootMargin: "100px",
        threshold: 0.01,
      }
    );
  }

  observe(img: HTMLImageElement) {
    this.observer.observe(img);
  }

  private async queueImageLoad(img: HTMLImageElement) {
    if (this.loading >= this.maxConcurrent) {
      this.loadingQueue.add(img);
      return;
    }

    this.loading++;
    this.loadingQueue.delete(img);

    try {
      const src = img.dataset.src;
      const srcset = img.dataset.srcset;

      if (src) {
        img.src = src;
        await new Promise((resolve) => {
          img.onload = () => {
            img.classList.add("loaded");
            resolve(null);
          };
          img.onerror = resolve;
        });
      }

      if (srcset) {
        img.srcset = srcset;
      }
    } finally {
      this.loading--;

      // Queue'daki sonraki image'i yükle
      if (this.loadingQueue.size > 0) {
        const nextImg = this.loadingQueue.values().next().value;
        this.queueImageLoad(nextImg);
      }
    }
  }

  disconnect() {
    this.observer.disconnect();
    this.loadingQueue.clear();
  }
}

/**
 * Singleton image observer instance
 */
let imageObserverInstance: ImageObserver | null = null;

export function getImageObserver(): ImageObserver {
  if (!imageObserverInstance && typeof window !== "undefined") {
    imageObserverInstance = new ImageObserver();
  }
  return imageObserverInstance!;
}
