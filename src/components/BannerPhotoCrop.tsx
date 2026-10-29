import { CachedImage } from "./common/CachedImage";
import React from "react";

// O banner legado mantém 13:10; a nova capa usa 8:3. A prévia mede a largura
// real disponível para o gesto e o bitmap exportado usarem o mesmo recorte.
const EXPORT_SCALE = 4;

export function BannerPhotoCrop({ file, onConfirm, onCancel, aspectRatio = 13 / 10 }: {
  file: File;
  aspectRatio?: number;
  onConfirm: (cropped: File) => void;
  onCancel: () => void;
}) {
  const [url, setUrl] = React.useState("");
  const [size, setSize] = React.useState({ width: 1, height: 1 });
  const [zoom, setZoom] = React.useState(1);
  const [offset, setOffset] = React.useState({ x: 0, y: 0 });
  const [working, setWorking] = React.useState(false);
  const [error, setError] = React.useState("");
  const imageRef = React.useRef<HTMLImageElement>(null);
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = React.useState(390);
  const BANNER_WIDTH = viewportWidth;
  const BANNER_HEIGHT = viewportWidth / aspectRatio;
  const dragRef = React.useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  React.useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const resize = () => setViewportWidth(element.getBoundingClientRect().width || 390);
    resize();
    const observer = new ResizeObserver(resize); observer.observe(element);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    const next = URL.createObjectURL(file);
    setUrl(next);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    return () => URL.revokeObjectURL(next);
  }, [file]);

  const scale = Math.max(BANNER_WIDTH / size.width, BANNER_HEIGHT / size.height) * zoom;
  const displayedWidth = size.width * scale;
  const displayedHeight = size.height * scale;
  const maxX = Math.max(0, (displayedWidth - BANNER_WIDTH) / 2);
  const maxY = Math.max(0, (displayedHeight - BANNER_HEIGHT) / 2);
  const clamp = (value: number, maximum: number) => Math.max(-maximum, Math.min(maximum, value));
  const x = clamp(offset.x, maxX);
  const y = clamp(offset.y, maxY);

  const confirm = async () => {
    const image = imageRef.current;
    if (!image?.naturalWidth || !image.naturalHeight) return;
    setWorking(true);
    setError("");
    try {
      const canvas = document.createElement("canvas");
      canvas.width = BANNER_WIDTH * EXPORT_SCALE;
      canvas.height = BANNER_HEIGHT * EXPORT_SCALE;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Não foi possível preparar a imagem.");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";

      // O canvas é 4x a geometria CSS; a implementação anterior desenhava
      // coordenadas CSS diretamente num canvas 4x, deixando apenas parte do
      // bitmap preenchida e alterando drasticamente o enquadramento salvo.
      context.scale(EXPORT_SCALE, EXPORT_SCALE);
      context.drawImage(
        image,
        (BANNER_WIDTH - displayedWidth) / 2 + x,
        (BANNER_HEIGHT - displayedHeight) / 2 + y,
        displayedWidth,
        displayedHeight,
      );

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.92));
      if (!blob) throw new Error("Não foi possível preparar a imagem.");
      onConfirm(new File([blob], `banner-${Date.now()}.webp`, { type: "image/webp" }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao preparar a imagem.");
    } finally {
      setWorking(false);
    }
  };

  return <div className="space-y-2" aria-label="Enquadrar imagem do banner">
    <div
      ref={viewportRef}
      className="relative mx-auto w-full max-w-[390px] touch-none overflow-hidden rounded-xl bg-slate-900"
      style={{ aspectRatio: `${BANNER_WIDTH} / ${BANNER_HEIGHT}` }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { x: event.clientX, y: event.clientY, left: x, top: y };
      }}
      onPointerMove={(event) => {
        if (!dragRef.current) return;
        setOffset({
          x: clamp(dragRef.current.left + event.clientX - dragRef.current.x, maxX),
          y: clamp(dragRef.current.top + event.clientY - dragRef.current.y, maxY),
        });
      }}
      onPointerUp={() => { dragRef.current = null; }}
      onPointerCancel={() => { dragRef.current = null; }}
    >
      {url && <CachedImage
        ref={imageRef}
        src={url}
        alt="Prévia do enquadramento"
        draggable={false}
        onLoad={(event) => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
        className="pointer-events-none absolute max-w-none select-none"
        style={{
          width: displayedWidth,
          height: displayedHeight,
          left: (BANNER_WIDTH - displayedWidth) / 2 + x,
          top: (BANNER_HEIGHT - displayedHeight) / 2 + y,
        }}
      />}
    </div>
    <label className="block text-xs font-semibold">Aproximar ou afastar
      <input type="range" min="1" max="3" step="0.01" value={zoom} onChange={(event) => {
        setZoom(Number(event.target.value));
        setOffset({ x: 0, y: 0 });
      }} className="w-full" />
    </label>
    <p className="text-xs text-slate-500">Arraste a imagem para escolher exatamente a área que aparecerá no banner.</p>
    {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
    <div className="flex gap-2">
      <button type="button" onClick={onCancel} className="rounded-lg border px-3 py-2 text-xs">Cancelar</button>
      <button type="button" disabled={working || !imageRef.current?.naturalWidth} onClick={() => void confirm()}
        className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Usar enquadramento</button>
    </div>
  </div>;
}
