package com.nvu.operacional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/* JADX INFO: loaded from: classes2.dex */
final class GtoMoneyValue {
    private static final long MAX_CENTS = 10000000000L;
    private static final long MIN_CENTS = 10000;
    private static final Pattern TOKEN = Pattern.compile("-?\\d[\\d.,]*");

    static boolean isPlausibleCents(long j) {
        return j >= 10000 && j <= 10000000000L;
    }

    private GtoMoneyValue() {
    }

    static Long parseCents(String str) {
        if (str == null) {
            return null;
        }
        Matcher matcher = TOKEN.matcher(str.replaceAll("\\s+", "").trim());
        if (!matcher.find()) {
            return null;
        }
        String strGroup = matcher.group();
        if (strGroup.startsWith("-")) {
            return null;
        }
        String strNormalizeNumberToken = normalizeNumberToken(strGroup);
        if (strNormalizeNumberToken.isEmpty()) {
            return null;
        }
        try {
            BigDecimal scale = new BigDecimal(strNormalizeNumberToken).setScale(2, RoundingMode.HALF_UP);
            if (scale.signum() <= 0) {
                return null;
            }
            return Long.valueOf(scale.movePointRight(2).longValueExact());
        } catch (Exception unused) {
            return null;
        }
    }

    static Double parseReais(String str) {
        Long cents = parseCents(str);
        if (cents == null) {
            return null;
        }
        return Double.valueOf(cents.longValue() / 100.0d);
    }

    static String canonical(String str) {
        Long cents = parseCents(str);
        if (cents == null || !isPlausibleCents(cents.longValue())) {
            return "";
        }
        return canonicalFromCents(cents.longValue());
    }

    static String canonicalFromCents(long j) {
        if (!isPlausibleCents(j)) {
            return "";
        }
        long whole = j / 100;
        long cents = Math.abs(j % 100);
        return String.format(Locale.ROOT, "R$ %s,%02d", groupThousands(whole), Long.valueOf(cents));
    }

    private static String groupThousands(long j) {
        String string = Long.toString(Math.abs(j));
        StringBuilder sb = new StringBuilder(string.length() + (string.length() / 3));
        for (int i = 0; i < string.length(); i++) {
            if (i > 0 && (string.length() - i) % 3 == 0) {
                sb.append('.');
            }
            sb.append(string.charAt(i));
        }
        if (j < 0) {
            sb.insert(0, '-');
        }
        return sb.toString();
    }

    static String finalValueCompatibilityIssue(String str, String str2) {
        Long cents = parseCents(str);
        Long cents2 = parseCents(str2);
        if (cents == null || cents2 == null || cents.longValue() <= 0 || cents2.longValue() <= 0) {
            return null;
        }
        double dLongValue = cents2.longValue() / cents.longValue();
        if (dLongValue >= 95.0d && dLongValue <= 105.0d) {
            return "Valor final incompatível com o frete: possível deslocamento de centavos (aprox. 100x).";
        }
        if (dLongValue > 20.0d || dLongValue < 0.05d) {
            return "Valor final incompatível com o valor ofertado do frete.";
        }
        return null;
    }

    private static String normalizeNumberToken(String str) {
        if (str == null || str.isEmpty()) {
            return "";
        }
        int iLastIndexOf = str.lastIndexOf(44);
        int iLastIndexOf2 = str.lastIndexOf(46);
        if (iLastIndexOf >= 0 && iLastIndexOf2 >= 0) {
            if (iLastIndexOf > iLastIndexOf2) {
                return str.replace(".", "").replace(',', '.');
            }
            return str.replace(",", "");
        }
        if (iLastIndexOf >= 0) {
            int length = (str.length() - iLastIndexOf) - 1;
            if (length == 1 || length == 2) {
                return str.replace(".", "").replace(',', '.');
            }
            return str.replace(",", "");
        }
        if (iLastIndexOf2 < 0) {
            return str;
        }
        int i = 0;
        for (int i2 = 0; i2 < str.length(); i2++) {
            if (str.charAt(i2) == '.') {
                i++;
            }
        }
        int length2 = (str.length() - iLastIndexOf2) - 1;
        return (i == 1 && (length2 == 1 || length2 == 2)) ? str : str.replace(".", "");
    }
}
