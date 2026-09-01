/**
 * Mobile Optimization Utilities
 * Mobil cihazlarda performans ve UX optimizasyonu
 */

/**
 * Mobile Viewport Configuration
 */
export const mobileOptimization = {
  /**
   * Viewport meta tag'ı yapılandır
   */
  setupViewport(): void {
    if (typeof document === "undefined") return;

    // Viewport meta tag'ı kontrol et
    let viewportMeta = document.querySelector('meta[name="viewport"]');
    if (!viewportMeta) {
      viewportMeta = document.createElement("meta");
      viewportMeta.name = "viewport";
      document.head.appendChild(viewportMeta);
    }

    // Content ayarla
    viewportMeta.setAttribute(
      "content",
      [
        "width=device-width",
        "initial-scale=1",
        "maximum-scale=5",
        "user-scalable=yes",
        "viewport-fit=cover",
        "shrink-to-fit=no",
      ].join(", "),
    );
  },

  /**
   * Mobil cihazda haptic feedback
   */
  triggerHaptic(pattern: "light" | "medium" | "heavy" = "light"): void {
    if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;

    const durations = {
      light: 10,
      medium: 50,
      heavy: 100,
    };

    navigator.vibrate?.(durations[pattern]);
  },

  /**
   * Safe area inset'leri al (notch/cutout için)
   */
  getSafeAreaInsets(): {
    top: number;
    right: number;
    bottom: number;
    left: number;
  } {
    if (typeof window === "undefined") {
      return { top: 0, right: 0, bottom: 0, left: 0 };
    }

    const root = document.documentElement;
    const styles = getComputedStyle(root);

    return {
      top: parseFloat(styles.getPropertyValue("--safe-area-inset-top")) || 0,
      right: parseFloat(styles.getPropertyValue("--safe-area-inset-right")) || 0,
      bottom: parseFloat(styles.getPropertyValue("--safe-area-inset-bottom")) || 0,
      left: parseFloat(styles.getPropertyValue("--safe-area-inset-left")) || 0,
    };
  },

  /**
   * Bottom sheet ve modal için safe area padding
   */
  getSafeAreaStyle(): React.CSSProperties {
    const insets = mobileOptimization.getSafeAreaInsets();
    return {
      paddingTop: `max(${insets.top}px, var(--default-top, 0px))`,
      paddingRight: `max(${insets.right}px, var(--default-right, 0px))`,
      paddingBottom: `max(${insets.bottom}px, var(--default-bottom, 0px))`,
      paddingLeft: `max(${insets.left}px, var(--default-left, 0px))`,
    };
  },

  /**
   * Zoom engellemek (ama user-scalable = yes)
   */
  preventDoubleClickZoom(): () => void {
    if (typeof window === "undefined") return () => {};

    let lastTouchEnd = 0;

    const handleTouchEnd = () => {
      const now = Date.now();
      if (now - lastTouchEnd <= 300) {
        // Double tap
        if (document.activeElement instanceof HTMLInputElement) {
          document.activeElement.blur();
        }
      }
      lastTouchEnd = now;
    };

    document.addEventListener("touchend", handleTouchEnd, false);

    return () => {
      document.removeEventListener("touchend", handleTouchEnd, false);
    };
  },

  /**
   * Scroll performance optimization
   */
  enablePassiveScrollListener(): () => void {
    if (typeof window === "undefined") return () => {};

    const options = { passive: true };

    const handleScroll = () => {
      // Scroll event handler - lightweight
    };

    window.addEventListener("scroll", handleScroll, options);

    return () => {
      window.removeEventListener("scroll", handleScroll, options);
    };
  },

  /**
   * Touch action optimization
   */
  optimizeTouchActions(): void {
    if (typeof document === "undefined") return;

    // CSS touch-action rules
    const style = document.createElement("style");
    style.textContent = `
      /* Dokunma performansını optimize et */
      * {
        -webkit-touch-callout: none;
        -webkit-user-select: none;
      }
      
      input, textarea, [contenteditable="true"] {
        -webkit-user-select: text;
        user-select: text;
      }
      
      /* Pointer events optimize */
      button, a, [role="button"] {
        touch-action: manipulation;
      }
      
      /* Font smoothing */
      body {
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }
    `;
    document.head.appendChild(style);
  },
};

/**
 * React Hook - Mobile Optimization
 */
import { useEffect } from "react";
import React from "react";

export function useMobileOptimization() {
  useEffect(() => {
    mobileOptimization.setupViewport();
    mobileOptimization.optimizeTouchActions();

    const unsubscribeDoubleClick = mobileOptimization.preventDoubleClickZoom();
    const unsubscribeScroll = mobileOptimization.enablePassiveScrollListener();

    return () => {
      unsubscribeDoubleClick();
      unsubscribeScroll();
    };
  }, []);

  return {
    triggerHaptic: mobileOptimization.triggerHaptic,
    getSafeAreaInsets: mobileOptimization.getSafeAreaInsets,
    getSafeAreaStyle: mobileOptimization.getSafeAreaStyle,
  };
}

/**
 * Orientation Management
 */
export const orientationManager = {
  /**
   * Current orientation
   */
  getCurrentOrientation(): "portrait" | "landscape" {
    if (typeof window === "undefined") return "portrait";
    return window.innerHeight > window.innerWidth ? "portrait" : "landscape";
  },

  /**
   * Orientation değişikliğini dinle
   */
  onOrientationChange(callback: (orientation: "portrait" | "landscape") => void) {
    if (typeof window === "undefined") return () => {};

    const handleChange = () => {
      callback(orientationManager.getCurrentOrientation());
    };

    window.addEventListener("orientationchange", handleChange);
    window.addEventListener("resize", handleChange);

    return () => {
      window.removeEventListener("orientationchange", handleChange);
      window.removeEventListener("resize", handleChange);
    };
  },

  /**
   * Landscape modda sağ tarafını göster
   */
  getRightSafeArea(): number {
    if (orientationManager.getCurrentOrientation() === "landscape") {
      return mobileOptimization.getSafeAreaInsets().right;
    }
    return 0;
  },

  /**
   * Full-screen API (fullscreen mode)
   */
  async requestFullscreen(element: HTMLElement): Promise<void> {
    if (!element.requestFullscreen) return;

    try {
      await element.requestFullscreen({
        navigationUI: "hide",
      });
    } catch (e) {
      console.error("Fullscreen request failed:", e);
    }
  },
};

/**
 * React Hook - Orientation Management
 */
export function useOrientation() {
  const [orientation, setOrientation] = React.useState<"portrait" | "landscape">(
    orientationManager.getCurrentOrientation(),
  );

  useEffect(() => {
    const unsubscribe = orientationManager.onOrientationChange(setOrientation);
    return unsubscribe;
  }, []);

  return {
    orientation,
    isPortrait: orientation === "portrait",
    isLandscape: orientation === "landscape",
  };
}

/**
 * Touch Gesture Detection
 */
export interface GesturePoint {
  x: number;
  y: number;
  time: number;
}

export const gestureDetector = {
  /**
   * Swipe gesture algıla
   */
  detectSwipe(
    onSwipe: (direction: "left" | "right" | "up" | "down", distance: number) => void,
    threshold: number = 50,
  ): (event: TouchEvent) => void {
    let startX = 0;
    let startY = 0;

    return (event: TouchEvent) => {
      if (event.type === "touchstart") {
        startX = event.touches[0]!.clientX;
        startY = event.touches[0]!.clientY;
      } else if (event.type === "touchend") {
        const endX = event.changedTouches[0]!.clientX;
        const endY = event.changedTouches[0]!.clientY;

        const diffX = endX - startX;
        const diffY = endY - startY;

        const absDiffX = Math.abs(diffX);
        const absDiffY = Math.abs(diffY);

        if (absDiffX > threshold) {
          onSwipe(diffX > 0 ? "right" : "left", absDiffX);
        } else if (absDiffY > threshold) {
          onSwipe(diffY > 0 ? "down" : "up", absDiffY);
        }
      }
    };
  },

  /**
   * Pinch zoom algıla
   */
  detectPinch(onPinch: (scale: number) => void): (event: TouchEvent) => void {
    let lastDistance = 0;

    return (event: TouchEvent) => {
      if (event.touches.length === 2) {
        const touch1 = event.touches[0]!;
        const touch2 = event.touches[1]!;

        const distance = Math.hypot(
          touch2.clientX - touch1.clientX,
          touch2.clientY - touch1.clientY,
        );

        if (lastDistance !== 0) {
          const scale = distance / lastDistance;
          onPinch(scale);
        }

        lastDistance = distance;
      } else {
        lastDistance = 0;
      }
    };
  },
};

/**
 * React Hook - Gesture Detection
 */
export function useGestureDetector(
  onSwipe?: (direction: "left" | "right" | "up" | "down", distance: number) => void,
  onPinch?: (scale: number) => void,
) {
  const elementRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!elementRef.current) return;

    const swipeHandler = onSwipe ? gestureDetector.detectSwipe(onSwipe) : null;
    const pinchHandler = onPinch ? gestureDetector.detectPinch(onPinch) : null;

    const handleTouchStart = (e: TouchEvent) => {
      swipeHandler?.(e);
      pinchHandler?.(e);
    };

    const handleTouchEnd = (e: TouchEvent) => {
      swipeHandler?.(e);
    };

    const handleTouchMove = (e: TouchEvent) => {
      pinchHandler?.(e);
    };

    elementRef.current.addEventListener("touchstart", handleTouchStart);
    elementRef.current.addEventListener("touchend", handleTouchEnd);
    elementRef.current.addEventListener("touchmove", handleTouchMove);

    return () => {
      if (elementRef.current) {
        elementRef.current.removeEventListener("touchstart", handleTouchStart);
        elementRef.current.removeEventListener("touchend", handleTouchEnd);
        elementRef.current.removeEventListener("touchmove", handleTouchMove);
      }
    };
  }, [onSwipe, onPinch]);

  return elementRef;
}

/**
 * Keyboard Management
 */
export const keyboardManager = {
  /**
   * Virtual keyboard gösterilip gösterilmediğini kontrol et
   */
  getKeyboardHeight(): number {
    if (typeof window === "undefined") return 0;

    const windowHeight = window.innerHeight;
    const screenHeight = window.screen.height;

    return Math.max(0, screenHeight - windowHeight);
  },

  /**
   * Keyboard gösterim/gizleme dinle
   */
  onKeyboardChange(callback: (visible: boolean, height: number) => void) {
    if (typeof window === "undefined") return () => {};

    let lastHeight = keyboardManager.getKeyboardHeight();

    const handleResize = () => {
      const currentHeight = keyboardManager.getKeyboardHeight();
      if (currentHeight !== lastHeight) {
        lastHeight = currentHeight;
        callback(currentHeight > 0, currentHeight);
      }
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
    };
  },
};

/**
 * React Hook - Keyboard Management
 */
export function useKeyboardHeight() {
  const [keyboardHeight, setKeyboardHeight] = React.useState(0);
  const [isKeyboardVisible, setIsKeyboardVisible] = React.useState(false);

  useEffect(() => {
    const unsubscribe = keyboardManager.onKeyboardChange((visible, height) => {
      setIsKeyboardVisible(visible);
      setKeyboardHeight(height);
    });

    return unsubscribe;
  }, []);

  return { keyboardHeight, isKeyboardVisible };
}
