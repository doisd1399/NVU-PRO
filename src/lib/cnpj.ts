const onlyDigits = (value: string): string => value.replace(/\D/g, "");

export const formatCnpj = (value: string): string => {
  const digits = onlyDigits(value).slice(0, 14);
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  if (digits.length <= 8) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
  }
  if (digits.length <= 12) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
  }
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
};

export const isValidCnpj = (value: string): boolean => {
  const digits = onlyDigits(value);
  if (digits.length !== 14 || /^([0-9])\1+$/.test(digits)) return false;

  const calculateDigit = (base: string): string => {
    let weight = base.length - 7;
    let sum = 0;
    for (const digit of base) {
      sum += Number(digit) * weight;
      weight -= 1;
      if (weight === 1) weight = 9;
    }
    const remainder = sum % 11;
    return remainder < 2 ? "0" : String(11 - remainder);
  };

  const first = calculateDigit(digits.slice(0, 12));
  const second = calculateDigit(digits.slice(0, 12) + first);
  return digits.slice(-2) === first + second;
};

/** Generates a syntactically valid random CNPJ for legacy automatic forms. */
export const generateCnpj = (): string => {
  const root = Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)).join("");
  const branch = "0001";
  const base = root + branch;
  const calculateDigit = (value: string): string => {
    let weight = value.length - 7;
    let sum = 0;
    for (const digit of value) {
      sum += Number(digit) * weight;
      weight -= 1;
      if (weight === 1) weight = 9;
    }
    const remainder = sum % 11;
    return remainder < 2 ? "0" : String(11 - remainder);
  };
  const digits = base + calculateDigit(base);
  return formatCnpj(digits + calculateDigit(digits));
};
