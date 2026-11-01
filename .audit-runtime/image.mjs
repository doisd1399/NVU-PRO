// image-stub:cached
var CachedImage = (props) => globalThis.__auditReact.createElement("img", props);

// src/components/common/StableImage.tsx
import { useEffect, useState } from "react";

// image-stub:imageCache
var isImageReady = () => globalThis.__auditImageReady === true;
var preloadImage = () => Promise.resolve();
var rememberImageReady = () => {
};
var subscribeImageReady = () => () => {
};

// image-stub:utils
var cn = (...values) => values.filter(Boolean).join(" ");

// image-stub:persistent
var usePersistentRankingImage = (src) => ({ src, onLoad: () => {
}, onError: () => {
} });

// src/components/common/StableImage.tsx
import { jsx, jsxs } from "react/jsx-runtime";
function StableImage({
  src,
  persistentViewerId,
  persistentAssetId,
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
}) {
  const persistent = usePersistentRankingImage(src?.trim() || "", persistentViewerId, persistentAssetId, imageProps.loading !== "lazy");
  const normalizedSrc = persistent.src;
  const [failedSrc, setFailedSrc] = useState(null);
  const [loadedSrc, setLoadedSrc] = useState(
    () => isImageReady(normalizedSrc) ? normalizedSrc : null
  );
  const failed = failedSrc === normalizedSrc;
  const loaded = loadedSrc === normalizedSrc || isImageReady(normalizedSrc);
  const requestedLoading = imageProps.loading;
  const shouldPreload = preload && requestedLoading !== "lazy";
  useEffect(() => {
    setFailedSrc((current) => current === normalizedSrc ? current : null);
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
  useEffect(() => {
    const retry = () => {
      setFailedSrc(null);
    };
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, []);
  const fallbackHidden = !failed && (loaded || hideFallbackWhenCached && isImageReady(normalizedSrc));
  const fallbackVisibilityHidden = fallbackHidden || hideFallbackWhileLoading && Boolean(normalizedSrc) && !failed;
  return /* @__PURE__ */ jsxs(
    "span",
    {
      className: cn(
        "relative inline-flex overflow-hidden align-middle [contain:layout_paint] [isolation:isolate]",
        wrapperClassName
      ),
      children: [
        /* @__PURE__ */ jsx(
          "span",
          {
            "aria-hidden": "true",
            className: cn(
              "absolute inset-0 z-0 flex items-center justify-center",
              fallbackVisibilityHidden ? "invisible" : "visible"
            ),
            children: fallback
          }
        ),
        normalizedSrc && !failed && /* @__PURE__ */ jsx(
          CachedImage,
          {
            ...imageProps,
            src: normalizedSrc,
            loading: requestedLoading ?? (shouldPreload ? "eager" : "lazy"),
            alt,
            draggable: imageProps.draggable ?? false,
            className: cn(
              "absolute inset-0 z-10 h-full w-full opacity-100 [backface-visibility:hidden] [transform:translateZ(0)]",
              className
            ),
            onLoad: (event) => {
              persistent.onLoad();
              setFailedSrc(null);
              setLoadedSrc(normalizedSrc);
              rememberImageReady(normalizedSrc);
              onLoad?.(event);
            },
            onError: (event) => {
              persistent.onError();
              setFailedSrc(normalizedSrc);
              setLoadedSrc(null);
              onError?.(event);
            }
          }
        )
      ]
    }
  );
}
export {
  StableImage
};
