/** Make a smaller transport copy; OCR, hashing and the durable original are untouched. */
export async function prepareTripReceipt(file: File): Promise<File> {
  if (file.size < 280_000 || typeof createImageBitmap !== "function") return file;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = async () => {
    const bitmap = await createImageBitmap(file);
    try {
      if (expired) return file;
      const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) return file;
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/webp", 0.92));
      // A tiny saving is not worth changing format. Unsupported codecs safely keep the original.
      if (expired || !blob || blob.type !== "image/webp" || blob.size > file.size * 0.85) return file;
      return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".webp", { type: "image/webp" });
    } finally { bitmap.close(); }
  };
  try {
    return await Promise.race([work().catch(() => file), new Promise<File>(resolve => {
      timer = setTimeout(() => { expired = true; resolve(file); }, 1_500);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
