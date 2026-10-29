export async function assertDecodable(blob: Blob): Promise<{ width: number; height: number }> {
  if (typeof document === "undefined") throw new Error("VEHICLE_PHOTO_DECODE_UNAVAILABLE");
  const objectUrl = URL.createObjectURL(blob);
  try {
    return await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const image = new Image();
      const timer = setTimeout(() => { image.src = ""; reject(new Error("VEHICLE_PHOTO_DECODE_TIMEOUT")); }, 10_000);
      image.onload = () => {
        clearTimeout(timer);
        image.naturalWidth > 0 && image.naturalWidth * image.naturalHeight <= 40_000_000
          ? resolve({ width: image.naturalWidth, height: image.naturalHeight }) : reject(new Error("VEHICLE_PHOTO_DECODE_INVALID"));
      };
      image.onerror = () => { clearTimeout(timer); reject(new Error("VEHICLE_PHOTO_DECODE_INVALID")); };
      image.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
