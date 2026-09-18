package com.nvu.operacional;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Conservative origin extractor for the already-selected freight row. It never chooses
 * a row and never invents text. It supports both one OCR line and wrapped/multi-line
 * route labels inside the immutable selected-row ROI.
 */
final class GtoOriginGeometryPolicy {
    static final class Token {
        final String text;
        final int left;
        final int right;
        Token(String text, int left, int right) {
            this.text = text == null ? "" : text.trim();
            this.left = left;
            this.right = right;
        }
    }

    static final class RowLine {
        final String text;
        final int top;
        final int bottom;
        final int left;
        final int right;
        RowLine(String text, int top, int bottom, int left, int right) {
            this.text = text == null ? "" : text.trim();
            this.top = top;
            this.bottom = bottom;
            this.left = left;
            this.right = right;
        }
        int centerY() { return top + Math.max(0, bottom - top) / 2; }
    }

    static final class Result {
        final String value;
        final boolean strong;
        final String source;
        Result(String value, boolean strong, String source) {
            this.value = GtoListOriginTextPolicy.canonicalizeOcrLiteral(value);
            this.strong = strong;
            this.source = source == null ? "" : source;
        }
        static Result none() { return new Result("", false, "NONE"); }
    }

    private GtoOriginGeometryPolicy() {}

    static Result infer(String rawLine, List<Token> rawTokens, String destinationCompanyHint, int lineHeight) {
        String raw = clean(rawLine);
        if (raw.isEmpty()) return Result.none();

        int separator = separatorIndex(raw);
        if (separator > 0) {
            String direct = clean(raw.substring(0, separator));
            if (plausible(direct)) return new Result(direct, true, "VISIBLE_SEPARATOR");
        }

        List<Token> tokens = new ArrayList<>();
        if (rawTokens != null) {
            for (Token token : rawTokens) {
                if (token == null) continue;
                String text = clean(token.text);
                if (text.isEmpty() || isSeparator(text)) continue;
                tokens.add(new Token(text, token.left, token.right));
            }
        }
        if (tokens.size() < 2) return Result.none();
        tokens.sort((a, b) -> Integer.compare(a.left, b.left));

        String destinationHint = clean(destinationCompanyHint);
        if (!destinationHint.isEmpty()) {
            int suffixStart = matchingSuffixStart(tokens, destinationHint);
            if (suffixStart > 0) {
                String origin = join(tokens, 0, suffixStart);
                if (plausible(origin)) return new Result(origin, true, "DESTINATION_ANCHORED_GEOMETRY");
            }
        }

        int largestGap = Integer.MIN_VALUE;
        int secondGap = Integer.MIN_VALUE;
        int split = -1;
        for (int i = 0; i < tokens.size() - 1; i++) {
            int gap = tokens.get(i + 1).left - tokens.get(i).right;
            if (gap > largestGap) {
                secondGap = largestGap;
                largestGap = gap;
                split = i + 1;
            } else if (gap > secondGap) {
                secondGap = gap;
            }
        }
        if (secondGap == Integer.MIN_VALUE) secondGap = 0;
        int h = Math.max(8, lineHeight);
        boolean dominantGap = largestGap >= Math.max(5, Math.round(h * 0.24f))
            && largestGap >= secondGap + Math.max(2, Math.round(h * 0.08f));
        if (!dominantGap || split <= 0 || split >= tokens.size()) return Result.none();

        String origin = join(tokens, 0, split);
        return plausible(origin)
            ? new Result(origin, true, "DOMINANT_GAP_GEOMETRY")
            : Result.none();
    }

    /**
     * Reads the route band of the already-selected row across OCR line breaks.
     * Lines must belong to one immutable selected-row crop. The method never chooses
     * another freight row.
     */
    /**
     * Recovers an expected origin only when its normalized words appear as a
     * literal prefix across the OCR lines of this selected row. The helper is
     * intentionally fail-closed: a missing or conflicting prefix returns none.
     */
    static Result inferFromExpectedOriginPrefix(
        List<RowLine> rawLines,
        String expectedOrigin,
        int rowTop,
        int rowBottom
    ) {
        if (rawLines == null || rawLines.isEmpty() || rowBottom <= rowTop) return Result.none();
        String expected = clean(expectedOrigin);
        String wanted = norm(expected);
        if (wanted.isEmpty()) return Result.none();

        List<RowLine> lines = new ArrayList<>();
        for (RowLine line : rawLines) {
            if (line == null) continue;
            if (line.centerY() < rowTop || line.centerY() > rowBottom) continue;
            String text = clean(line.text);
            if (text.isEmpty() || isMetricOrActionLabel(text)) continue;
            lines.add(new RowLine(text, line.top, line.bottom, line.left, line.right));
        }
        lines.sort((a, b) -> {
            int byY = Integer.compare(a.centerY(), b.centerY());
            return byY != 0 ? byY : Integer.compare(a.left, b.left);
        });
        if (lines.isEmpty()) return Result.none();

        List<String> literalWords = new ArrayList<>();
        for (RowLine line : lines) {
            String text = clean(line.text)
                .replace("→", " ").replace("->", " ")
                .replace(">", " ").replace("›", " ").replace("»", " ");
            for (String word : text.split("\\s+")) {
                String cleanedWord = clean(word);
                if (!cleanedWord.isEmpty()) literalWords.add(cleanedWord);
            }
        }
        String[] wantedWords = wanted.split(" ");
        if (wantedWords.length == 0 || literalWords.size() < wantedWords.length) return Result.none();
        for (int start = 0; start + wantedWords.length <= literalWords.size(); start++) {
            boolean matches = true;
            for (int i = 0; i < wantedWords.length; i++) {
                if (!norm(literalWords.get(start + i)).equals(wantedWords[i])) {
                    matches = false;
                    break;
                }
            }
            if (!matches) continue;
            StringBuilder literal = new StringBuilder();
            for (int i = 0; i < wantedWords.length; i++) {
                if (literal.length() > 0) literal.append(' ');
                literal.append(literalWords.get(start + i));
            }
            String result = clean(literal.toString());
            if (plausible(result)) return new Result(result, true, "EXPECTED_ORIGIN_LITERAL_PREFIX");
        }
        return Result.none();
    }

    static Result inferFromRowLines(List<RowLine> rawLines, String destinationCompanyHint, int rowTop, int rowBottom) {
        if (rawLines == null || rawLines.isEmpty() || rowBottom <= rowTop) return Result.none();
        int rowHeight = Math.max(1, rowBottom - rowTop);
        List<RowLine> all = new ArrayList<>();
        for (RowLine line : rawLines) {
            if (line == null) continue;
            String text = clean(line.text);
            if (isMetricOrActionLabel(text)) continue;
            if (!plausible(text)) continue;
            String n = norm(text);
            float rel = (line.centerY() - rowTop) / (float) rowHeight;
            if (rel >= 0.08f && rel <= 0.88f) {
                all.add(new RowLine(text, line.top, line.bottom, line.left, line.right));
            }
        }
        if (all.isEmpty()) return Result.none();
        all.sort((a, b) -> {
            int byY = Integer.compare(a.centerY(), b.centerY());
            return byY != 0 ? byY : Integer.compare(a.left, b.left);
        });

        int cargoIndex = -1;
        int destinationIndex = -1;
        for (int i = 0; i < all.size(); i++) {
            float rel = (all.get(i).centerY() - rowTop) / (float) rowHeight;
            if (cargoIndex < 0 && rel <= 0.43f) cargoIndex = i;
            if (rel >= 0.56f) destinationIndex = i;
        }

        List<RowLine> lines = new ArrayList<>();
        for (int i = 0; i < all.size(); i++) {
            if (i == cargoIndex || i == destinationIndex) continue;
            if (cargoIndex >= 0 && i <= cargoIndex) continue;
            if (destinationIndex >= 0 && i >= destinationIndex) continue;
            float rel = (all.get(i).centerY() - rowTop) / (float) rowHeight;
            if (rel >= 0.28f && rel <= 0.68f) lines.add(all.get(i));
        }
        if (lines.isEmpty()) {
            // Fallback for compact cards where OCR collapses vertical spacing. Still
            // exclude the identified cargo and destination labels.
            for (int i = 0; i < all.size(); i++) {
                if (i == cargoIndex || i == destinationIndex) continue;
                float rel = (all.get(i).centerY() - rowTop) / (float) rowHeight;
                if (rel >= 0.28f && rel <= 0.68f) lines.add(all.get(i));
            }
        }
        if (lines.isEmpty()) return Result.none();

        // First prefer an explicit visible separator anywhere in the route band.
        for (RowLine line : lines) {
            int sep = separatorIndex(line.text);
            if (sep > 0) {
                String origin = clean(line.text.substring(0, sep));
                if (plausible(origin)) return new Result(origin, true, "ROW_ROI_VISIBLE_SEPARATOR");
            }
        }

        String hint = clean(destinationCompanyHint);
        if (!hint.isEmpty()) {
            String wanted = norm(hint);
            for (int i = 0; i < lines.size(); i++) {
                String current = norm(lines.get(i).text);
                if (current.equals(wanted) || current.endsWith(" " + wanted) || wanted.endsWith(" " + current)) {
                    String origin = joinRowLines(lines, 0, i);
                    if (plausible(origin)) return new Result(origin, true, "ROW_ROI_DESTINATION_ANCHOR");
                }
            }
            String combined = joinRowLines(lines, 0, lines.size());
            String normalizedCombined = norm(combined);
            int idx = normalizedCombined.lastIndexOf(wanted);
            if (idx > 0) {
                String originNorm = normalizedCombined.substring(0, idx).trim();
                String literal = prefixByNormalizedWords(lines, originNorm);
                if (plausible(literal)) return new Result(literal, true, "ROW_ROI_DESTINATION_SUFFIX");
            }
        }

        // When ML Kit drops the separator but emits source/destination companies as
        // separate boxes on the same horizontal route band, geometry is still exact.
        // Use the left-most route fragment only when another fragment sits on the same
        // line to its right; this never splits a single ambiguous merged phrase.
        if (lines.size() >= 2) {
            RowLine bestLeft = null;
            RowLine bestRight = null;
            int maxDy = Math.max(3, Math.round(rowHeight * 0.12f));
            for (RowLine a : lines) {
                for (RowLine b : lines) {
                    if (a == b || b.left <= a.left) continue;
                    if (Math.abs(a.centerY() - b.centerY()) > maxDy) continue;
                    int gap = b.left - a.right;
                    if (gap < -Math.max(2, rowHeight / 30)) continue;
                    if (bestLeft == null || a.left < bestLeft.left) {
                        bestLeft = a;
                        bestRight = b;
                    }
                }
            }
            if (bestLeft != null && bestRight != null) {
                String origin = clean(bestLeft.text);
                if (plausible(origin)) {
                    return new Result(origin, true, "ROW_ROI_HORIZONTAL_ROUTE_SPLIT");
                }
            }
        }

        // A single merged route phrase without a separator or destination-company anchor
        // is intentionally NOT accepted as Origem. It may contain both companies (for
        // example "Metalurgica Dalavan"). Returning unknown here lets the selected-row
        // retry and same-page unanimous-origin resolver recover the literal source without
        // either guessing or asking the driver prematurely.
        return Result.none();
    }

    private static String prefixByNormalizedWords(List<RowLine> lines, String normalizedPrefix) {
        if (normalizedPrefix == null || normalizedPrefix.isEmpty()) return "";
        String[] wanted = normalizedPrefix.split(" ");
        int remaining = wanted.length;
        StringBuilder out = new StringBuilder();
        for (RowLine line : lines) {
            String text = clean(line.text);
            if (text.isEmpty()) continue;
            String[] words = norm(text).split(" ");
            int take = Math.min(remaining, words.length);
            if (take <= 0) break;
            if (take == words.length) {
                if (out.length() > 0) out.append(' ');
                out.append(text);
            } else {
                String[] literalWords = text.split("\\s+");
                for (int i = 0; i < take && i < literalWords.length; i++) {
                    if (out.length() > 0) out.append(' ');
                    out.append(literalWords[i]);
                }
            }
            remaining -= take;
            if (remaining <= 0) break;
        }
        return clean(out.toString());
    }

    private static String joinRowLines(List<RowLine> lines, int start, int end) {
        StringBuilder out = new StringBuilder();
        for (int i = start; i < end && i < lines.size(); i++) {
            String value = clean(lines.get(i).text);
            if (value.isEmpty()) continue;
            if (out.length() > 0) out.append(' ');
            out.append(value);
        }
        return clean(out.toString());
    }

    private static int matchingSuffixStart(List<Token> tokens, String destinationHint) {
        String wanted = norm(destinationHint);
        if (wanted.isEmpty()) return -1;
        for (int start = tokens.size() - 1; start >= 1; start--) {
            String suffix = norm(join(tokens, start, tokens.size()));
            if (suffix.equals(wanted)) return start;
        }
        return -1;
    }

    private static String join(List<Token> tokens, int start, int end) {
        StringBuilder out = new StringBuilder();
        for (int i = start; i < end && i < tokens.size(); i++) {
            String value = clean(tokens.get(i).text);
            if (value.isEmpty()) continue;
            if (out.length() > 0) out.append(' ');
            out.append(value);
        }
        return clean(out.toString());
    }


    private static boolean isMetricOrActionLabel(String value) {
        String raw = clean(value);
        if (raw.isEmpty()) return true;
        String normalized = norm(raw);
        if (normalized.contains("aceitar")) return true;
        // Reject both compact and spaced OCR variants such as 600Km, 600 Km or 600 K m.
        if (raw.matches("(?i).*\\b\\d+(?:[.,]\\d+)?\\s*k\\s*m\\b.*")) return true;
        // Currency/value labels belong to the right metric column, never to Origem.
        if (raw.matches("(?i).*r\\s*[$sS]\\s*\\d.*") || raw.contains("$")) return true;
        // A metric-only OCR line with digits and no plausible company word is not route text.
        if (normalized.matches("^[0-9]+(?: [0-9]+)*$") ) return true;
        return false;
    }
    private static boolean plausible(String value) {
        String v = clean(value);
        if (v.length() < 2 || v.length() > 220) return false;
        int letters = 0;
        for (int i = 0; i < v.length(); i++) if (Character.isLetter(v.charAt(i))) letters++;
        return letters >= 2;
    }

    private static boolean isSeparator(String value) {
        return ">".equals(value) || "›".equals(value) || "»".equals(value);
    }

    private static int separatorIndex(String value) {
        int a = value.indexOf('>');
        int b = value.indexOf('›');
        int c = value.indexOf('»');
        int best = -1;
        for (int x : new int[] {a, b, c}) if (x >= 0 && (best < 0 || x < best)) best = x;
        return best;
    }

    private static String clean(String value) {
        return value == null ? "" : value.replaceAll("\\s+", " ").trim();
    }

    private static String norm(String value) {
        return Normalizer.normalize(clean(value), Normalizer.Form.NFD)
            .replaceAll("\\p{M}+", "")
            .toLowerCase(Locale.ROOT)
            .replaceAll("[^a-z0-9]+", " ")
            .replaceAll("\\s+", " ")
            .trim();
    }
}
