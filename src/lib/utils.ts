import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { normalizeTrip } from "./tripNormalizer";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function convertFileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () =>
      reject(reader.error || new Error("Não foi possível ler a imagem."));
    reader.onabort = () => reject(new Error("A leitura da imagem foi cancelada."));
    reader.readAsDataURL(file);
  });
}

export function compressImage(
  base64Str: string,
  maxWidth = 800,
  maxHeight = 800,
  quality = 0.8,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height *= maxWidth / width;
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width *= maxHeight / height;
          height = maxHeight;
        }
      }

      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      } else {
        reject(new Error("Não foi possível preparar a imagem para compactação."));
      }
    };
    img.onerror = () => {
      reject(new Error("Não foi possível abrir a imagem selecionada."));
    };
    img.src = base64Str;
  });
}

export function getJobRealTimestamp(job: any, historicoTrips: any[] = []): number {
  if (job.completedAt) {
    const completedTime = new Date(job.completedAt).getTime();
    if (!isNaN(completedTime) && completedTime > 0) return completedTime;
  }
  
  if (historicoTrips && historicoTrips.length > 0) {
    const timestamps = historicoTrips
      .map((trip) => normalizeTrip(trip))
      .filter((trip) => trip.isValid && trip.jobId === job.id)
      .map((trip) => trip.metricDate.getTime())
      .filter((timestamp) => Number.isFinite(timestamp) && timestamp > 0);

    if (timestamps.length > 0) {
      return Math.max(...timestamps);
    }
  }

  if (job.assignedAt) {
    const assignedTime = new Date(job.assignedAt).getTime();
    if (!isNaN(assignedTime) && assignedTime > 0) return assignedTime;
  }
  if (job.startedAt) {
    const startedTime = new Date(job.startedAt).getTime();
    if (!isNaN(startedTime) && startedTime > 0) return startedTime;
  }

  if (job.createdAt) {
    const createdTime = new Date(job.createdAt).getTime();
    if (!isNaN(createdTime) && createdTime > 0) return createdTime;
  }

  return 0;
}

export const getNomeContratoHistorico = (viagem: any, contrato?: any) => {
  return (
    viagem?.contractNameSnapshot ||
    viagem?.contratoNome ||
    viagem?.nomeContrato ||
    viagem?.contractName ||
    viagem?.contratoNumero ||
    viagem?.numeroContrato ||
    contrato?.name ||
    contrato?.nome ||
    contrato?.numero ||
    "Contrato não identificado"
  );
};

export const formatDriverName = (fullName?: string) => {
  if (!fullName) return "";
  const parts = fullName.trim().toLowerCase().split(/\s+/);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  
  const first = parts[0];
  const last = parts[parts.length - 1];
  return `${first.charAt(0).toUpperCase() + first.slice(1)} ${last.charAt(0).toUpperCase() + last.slice(1)}`;
};
