import React, { useEffect, useState } from "react";
import {
  isImageReady,
  preloadImage,
  rememberImageReady,
  subscribeImageReady,
} from "../../lib/imageCache";
import { cn } from "../../lib/utils";

interface StableImageProps
  extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> {
  src?: string | null;
  wrapperClassName: string;
  fallback: React.ReactNode;
  preload?: boolean;
  hideFallbackWhenCached?: boolean;
  /**
   * When true, a valid URL never shows the textual fallback while the first
   * network/decode request is in flight. This is used by the ranking, where
   * the page publishes only after the critical avatars are warmed and an
   * initials -> photo flash is therefore undesirable.
   */
  hideFallbackWhileLoading?: boolean;
}

/**
 * Fixed-size image layer with a deterministic fallback underneath it.
 *
 * The native image is visible from its first paint instead of being revealed by
 * React after onLoad. When the bitmap is already in the HTTP/WebView cache this
 * removes the one-frame initials -> photo flash. The fallback remains behind
 * the image until load completes and never changes layout dimensions.
 */
export function StableImage({
  src,
  wrapperClassName,
  fallback,
  preload = true,
  hideFallbackWhenCached = false,
  hideFallbackWhileLoading = false,
  className,
  alt = "",
  onLoad,
  onError,
  ...imageProps
}: StableImageProps) {
  const normalizedSrc = src?.trim() || "";
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(() =>
    isImageReady(normalizedSrc) ? normalizedSrc : null,
  );
  const failed = failedSrc === normalizedSrc;
  const loaded = loadedSrc === normalizedSrc || isImageReady(normalizedSrc);
  const requestedLoading = imageProps.loading;
  const shouldPreload = preload && requestedLoading !== "lazy";

  useEffect(() => {
    setFailedSrc((current) => (current === normalizedSrc ? current : null));
    setLoadedSrc(isImageReady(normalizedSrc) ? normalizedSrc : null);

    if (!normalizedSrc) return;

    const unsubscribe = subscribeImageReady(normalizedSrc, () => {
      setLoadedSrc(normalizedSrc);
      setFailedSrc(null);
    });

    if (shouldPreload && !isImageReady(normalizedSrc)) {
      void preloadImage(normalizedSrc);
    }

    return unsubscribe;
  }, [normalizedSrc, shouldPreload]);

  const fallbackHidden =
    loaded || (hideFallbackWhenCached && isImageReady(normalizedSrc));
  const fallbackVisibilityHidden =
    fallbackHidden ||
    (hideFallbackWhileLoading && Boolean(normalizedSrc) && !failed);

  return (
    <span
      className={cn(
        "relative inline-flex overflow-hidden align-middle [contain:layout_paint] [isolation:isolate]",
        wrapperClassName,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-0 z-0 flex items-center justify-center",
          fallbackVisibilityHidden ? "invisible" : "visible",
        )}
      >
        {fallback}
      </span>

      {normalizedSrc && !failed && (
        <img
          {...imageProps}
          src={normalizedSrc}
          loading={requestedLoading ?? (shouldPreload ? "eager" : "lazy")}
          alt={alt}
          draggable={imageProps.draggable ?? false}
          className={cn(
            "absolute inset-0 z-10 h-full w-full opacity-100 [backface-visibility:hidden] [transform:translateZ(0)]",
            className,
          )}
          onLoad={(event) => {
            setFailedSrc(null);
            setLoadedSrc(normalizedSrc);
            rememberImageReady(normalizedSrc);
            onLoad?.(event);
          }}
          onError={(event) => {
            setFailedSrc(normalizedSrc);
            setLoadedSrc(null);
            onError?.(event);
          }}
        />
      )}
    </span>
  );
}
