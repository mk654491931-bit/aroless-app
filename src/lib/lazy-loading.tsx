/**
 * Component Lazy Loading & Code Splitting Utilities
 * Bileşenleri talep üzerine yükle, bundle boyutunu küçült
 */

import { lazy, Suspense, ComponentType, ReactNode } from "react";
import type { RenderErrorBoundary } from "@tanstack/react-router";

/**
 * Güvenli lazy loading - Error boundary ile
 */
export function createLazyComponent<P extends object>(
  importFn: () => Promise<{ default: ComponentType<P> }>,
  fallback?: ReactNode,
): ComponentType<P> {
  const Component = lazy(() =>
    importFn().catch((error) => {
      console.error("Component load failed:", error);
      // Fallback component döndür
      return {
        default: () => fallback || <div>Component loading failed</div>,
      };
    }),
  );

  return function LazyComponent(props: P) {
    return (
      <Suspense fallback={fallback || <div>Loading...</div>}>
        <Component {...props} />
      </Suspense>
    );
  };
}

/**
 * Intersection Observer ile bileşen lazy loading
 */
export function createIntersectionLazyComponent<P extends object>(
  importFn: () => Promise<{ default: ComponentType<P> }>,
  options?: IntersectionObserverInit,
): ComponentType<P> {
  const Component = lazy(() =>
    new Promise<{ default: ComponentType<P> }>((resolve) => {
      if (typeof window === "undefined") {
        importFn().then(resolve);
        return;
      }

      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting) {
            observer.disconnect();
            importFn().then(resolve);
          }
        },
        { rootMargin: "50px", threshold: 0.01, ...options },
      );

      // Dummy element oluştur
      const dummy = document.createElement("div");
      observer.observe(dummy);
    }),
  );

  return function LazyComponent(props: P) {
    return <Component {...props} />;
  };
}

/**
 * Route-based lazy loading için TanStack Router yapılandırması
 */
export const lazyRouteConfig = {
  /**
   * Dosya tabanlı route lazy loading
   */
  createFileRoute: (path: string) => ({
    path,
    // Dosyayı lazy loading ile yükle
    component: lazy(() => import(/* @vite-ignore */ `./routes${path}`)),
  }),

  /**
   * Component lazy loading helper
   */
  getComponentLoader: (componentName: string) => {
    return lazy(() =>
      import(/* @vite-ignore */ `./components/${componentName}`).catch(() => ({
        default: () => <div>Component not found: {componentName}</div>,
      })),
    );
  },
};

/**
 * Resim lazy loading utility
 */
export function useLazyImage(src: string) {
  const [imageSrc, setImageSrc] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<Error | null>(null);

  React.useEffect(() => {
    if (!src) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          const img = new Image();
          img.onload = () => {
            setImageSrc(src);
            setIsLoading(false);
          };
          img.onerror = () => {
            setError(new Error(`Failed to load image: ${src}`));
            setIsLoading(false);
          };
          img.src = src;
          observer.disconnect();
        }
      },
      { rootMargin: "50px", threshold: 0.01 },
    );

    const div = document.createElement("div");
    observer.observe(div);

    return () => observer.disconnect();
  }, [src]);

  return { imageSrc, isLoading, error };
}

/**
 * Virtual Scrolling - Büyük listeleri optimize et
 */
interface VirtualScrollConfig {
  itemHeight: number;
  containerHeight: number;
  itemCount: number;
  overscan?: number;
}

export function useVirtualScroll(config: VirtualScrollConfig) {
  const { itemHeight, containerHeight, itemCount, overscan = 5 } = config;
  const [scrollTop, setScrollTop] = React.useState(0);

  const visibleRange = React.useMemo(() => {
    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const endIndex = Math.min(
      itemCount,
      Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan,
    );

    return {
      startIndex,
      endIndex,
      visibleItems: Array.from({ length: endIndex - startIndex }, (_, i) => startIndex + i),
      offsetY: startIndex * itemHeight,
    };
  }, [scrollTop, itemHeight, containerHeight, itemCount, overscan]);

  return {
    scrollTop,
    setScrollTop,
    ...visibleRange,
    totalHeight: itemCount * itemHeight,
  };
}

/**
 * Progressive Image Loading
 */
export function useProgressiveImage(
  lowQualitySrc: string,
  highQualitySrc: string,
  options?: { timeout?: number },
) {
  const [src, setSrc] = React.useState(lowQualitySrc);
  const [isLoaded, setIsLoaded] = React.useState(false);

  React.useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setSrc(highQualitySrc);
      setIsLoaded(true);
    };
    img.src = highQualitySrc;

    // Timeout sonra yüksek kaliteyi zorlama
    const timeout = setTimeout(() => {
      setSrc(highQualitySrc);
    }, options?.timeout ?? 5000);

    return () => clearTimeout(timeout);
  }, [highQualitySrc, options?.timeout]);

  return { src, isLoaded };
}

/**
 * On-demand script loading
 */
const scriptCache = new Map<string, Promise<boolean>>();

export function useLoadScript(
  src: string,
  options?: { async?: boolean; defer?: boolean },
): boolean {
  const [isLoaded, setIsLoaded] = React.useState(false);

  React.useEffect(() => {
    // Cache'de var mı kontrol et
    if (scriptCache.has(src)) {
      scriptCache.get(src)!.then(setIsLoaded);
      return;
    }

    // Yeni script yükle
    const promise = new Promise<boolean>((resolve) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve(true);
        return;
      }

      const script = document.createElement("script");
      script.src = src;
      script.async = options?.async ?? true;
      script.defer = options?.defer ?? false;

      script.onload = () => {
        setIsLoaded(true);
        resolve(true);
      };

      script.onerror = () => {
        console.error(`Failed to load script: ${src}`);
        resolve(false);
      };

      document.head.appendChild(script);
    });

    scriptCache.set(src, promise);
    promise.then(setIsLoaded);
  }, [src, options?.async, options?.defer]);

  return isLoaded;
}

/**
 * Conditional Loading - Duruma göre bileşen yükle
 */
export function ConditionalLazy<P extends object>({
  condition,
  component: Component,
  fallback,
}: {
  condition: boolean;
  component: ComponentType<P>;
  fallback?: ReactNode;
}) {
  if (!condition) return fallback || null;

  return (
    <Suspense fallback={fallback}>
      <Component />
    </Suspense>
  );
}

import React from "react";
