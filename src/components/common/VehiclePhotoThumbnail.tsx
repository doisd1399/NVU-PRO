import { Download, Info, LoaderCircle, Truck } from "lucide-react";
import { useState, type MouseEvent } from "react";
import { useVehiclePhoto } from "../../hooks/useVehiclePhoto";
import { StableImage } from "./StableImage";

export function VehiclePhotoThumbnail({ userId, simulatorId, vehicleId, vehicleName, companyId, className = "h-10 w-10", showInfoButton = false, onInfoClick, showDownloadButton = false }: {
  userId?: string; simulatorId?: string; vehicleId: string; vehicleName: string; companyId?: string; className?: string;
  showInfoButton?: boolean; onInfoClick?: () => void; showDownloadButton?: boolean;
}) {
  const { src } = useVehiclePhoto(userId && simulatorId ? { userId, simulatorId, vehicleId, vehicleName } : null, companyId || "");
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);

  const downloadPhoto = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!src || isDownloading) return;
    setIsDownloading(true);
    setDownloadError(false);
    try {
      const response = await fetch(src);
      if (!response.ok) throw new Error("vehicle-photo-download-failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${vehicleName.trim().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "veiculo"}.jpg`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setDownloadError(true);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className={`relative ${className} shrink-0`}>
      <StableImage src={src} alt={`Foto de ${vehicleName}`} wrapperClassName="h-full w-full rounded-lg bg-gray-50 text-gray-600 dark:bg-nvu-surface dark:text-nvu-text-soft" className="object-cover" fallback={<Truck size={20} />} />
      {(showInfoButton || showDownloadButton) && (
        <div className="absolute right-2 top-2 z-20 flex items-center gap-1">
          {showInfoButton && (
            <button type="button" aria-label={`Ver informações de ${vehicleName}`} title="Ver informações do veículo" onClick={(event) => { event.stopPropagation(); onInfoClick?.(); }} className="rounded-full bg-slate-950/65 p-1.5 text-white backdrop-blur-sm transition-colors hover:bg-slate-950/85">
              <Info size={15} />
            </button>
          )}
          {showDownloadButton && (
            <button type="button" aria-label={`Baixar foto de ${vehicleName}`} title={downloadError ? "Não foi possível baixar a foto" : "Baixar foto do veículo"} disabled={!src || isDownloading} onClick={downloadPhoto} className="rounded-full bg-slate-950/65 p-1.5 text-white backdrop-blur-sm transition-colors hover:bg-slate-950/85 disabled:cursor-not-allowed disabled:opacity-50">
              {isDownloading ? <LoaderCircle size={15} className="animate-spin" /> : <Download size={15} />}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
