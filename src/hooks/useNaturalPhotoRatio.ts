import { useCallback, useState } from "react";

/**
 * Proporção real da foto do veículo (largura ÷ altura), medida quando ela carrega. No desktop a caixa da foto adota essa proporção
 * (limitada entre `min` e `max`): a imagem preenche a caixa inteira — sem faixas cinzas ao redor — e as bordas arredondadas ficam na própria foto.
 * A variável CSS `--central-photo-natural` é lida só nas regras de janela larga; no celular segue o enquadramento compacto de sempre.
 */
export function useNaturalPhotoRatio(min = 1.4, max = 2.6) {
  const [ratio, setRatio] = useState<number | null>(null);
  const onLoad = useCallback((event: { currentTarget: HTMLImageElement } | React.SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget as HTMLImageElement;
    if (img?.naturalWidth > 0 && img?.naturalHeight > 0) setRatio(Math.min(max, Math.max(min, img.naturalWidth / img.naturalHeight)));
  }, [min, max]);
  const style = ratio ? ({ "--central-photo-natural": String(Math.round(ratio * 1000) / 1000) } as React.CSSProperties) : undefined;
  return { ratio, onLoad, style };
}
