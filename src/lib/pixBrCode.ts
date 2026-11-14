/**
 * Pix "copia e cola" (BR Code estático do Banco Central): o texto que o app do banco lê para pagar uma chave com valor.
 * Gerado no aparelho da empresa a partir da chave do motorista; o NVU não consulta banco nem move dinheiro.
 */
const tlv = (id: string, value: string) => `${id}${String(value.length).padStart(2, "0")}${value}`;
/** CRC16/CCITT-FALSE (polinômio 0x1021, início 0xFFFF), em 4 letras maiúsculas. */
export function crc16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}
/** Nome/cidade do recebedor: sem acento, só letras, números e espaço, em maiúsculas e no tamanho que o padrão aceita. */
export const brText = (value: string, max: number, fallback: string): string => {
  const clean = value.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9 ]/g, " ").replace(/\s+/g, " ").trim().toUpperCase().slice(0, max).trim();
  return clean || fallback;
};
export type PixCharge = { key: string; amountCents: number; name: string; city?: string; txid?: string };
/** Código Pix copia e cola de valor fixo. `key` já vem no formato do Pix (CPF/CNPJ só números, telefone +55…, e-mail minúsculo, chave aleatória). */
export function buildPixBrCode({ key, amountCents, name, city = "BRASIL", txid = "***" }: PixCharge): string {
  const cleanKey = key.trim();
  if (!cleanKey || cleanKey.length > 77) throw new Error("Chave Pix inválida para gerar o código.");
  if (!Number.isInteger(amountCents) || amountCents < 1 || amountCents > 99_999_999_999) throw new Error("Valor inválido para gerar o código Pix.");
  const reference = txid === "***" ? txid : txid.replace(/[^A-Za-z0-9]/g, "").slice(0, 25) || "***";
  const body = tlv("00", "01") + tlv("01", "11") + tlv("26", tlv("00", "br.gov.bcb.pix") + tlv("01", cleanKey)) + tlv("52", "0000") + tlv("53", "986")
    + tlv("54", (amountCents / 100).toFixed(2)) + tlv("58", "BR") + tlv("59", brText(name, 25, "RECEBEDOR")) + tlv("60", brText(city, 15, "BRASIL")) + tlv("62", tlv("05", reference)) + "6304";
  return body + crc16(body);
}
/** Lê um código copia e cola de volta em campos (para conferir o que foi gerado). */
export function parsePixBrCode(code: string): { fields: Record<string, string>; crcOk: boolean } {
  const fields: Record<string, string> = {};
  for (let i = 0; i < code.length;) { const id = code.slice(i, i + 2), length = Number(code.slice(i + 2, i + 4)); if (!Number.isInteger(length)) break; fields[id] = code.slice(i + 4, i + 4 + length); i += 4 + length; }
  return { fields, crcOk: code.length > 8 && crc16(code.slice(0, -4)) === code.slice(-4) };
}
