import React, { forwardRef, useEffect, useRef, useSyncExternalStore } from "react";
import { cacheDisplayImage, displayImageViewer, readDisplayImage, repairDisplayImage, subscribeDisplayImage, subscribeDisplayViewer } from "../../services/displayImageStore";

/** Same img semantics, with persistent bytes reused across routes and app restarts. */
export const CachedImage = forwardRef<HTMLImageElement, React.ImgHTMLAttributes<HTMLImageElement>>(function CachedImage({ src = "", onError, onLoad, ...props }, ref) {
  const viewer = useSyncExternalStore(subscribeDisplayViewer, displayImageViewer, () => "public");
  const cached = useSyncExternalStore(listener => subscribeDisplayImage(viewer, src, listener), () => readDisplayImage(viewer, src), () => "");
  const repaired = useRef("");
  useEffect(() => {
    if (!src || props.loading === "lazy") return;
    void cacheDisplayImage(viewer, src);
  }, [viewer, src, props.loading]);
  return <img {...props} ref={ref} src={cached || src || undefined} onLoad={event => {
    void cacheDisplayImage(viewer, src);
    onLoad?.(event);
  }} onError={event => {
    if (cached && navigator.onLine !== false && repaired.current !== viewer + src) {
      repaired.current = viewer + src;
      void repairDisplayImage(viewer, src);
    } else onError?.(event);
  }}/>;
});
