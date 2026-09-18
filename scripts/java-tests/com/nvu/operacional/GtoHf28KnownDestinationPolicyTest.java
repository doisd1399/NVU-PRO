package com.nvu.operacional;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

public final class GtoHf28KnownDestinationPolicyTest {
    public static void main(String[] args) {
        List<String> official = Arrays.asList(
            "Itapetuna", "Nova Macaé", "Registro", "Águas Velhas", "Cruz do Oeste", "Lauro Muller"
        );

        check("Itapetuna".equals(GtoCityTextResolver.uniqueOfficialCanonicalCandidate("Itopetuna", official)),
            "one-edit Itopetuna must uniquely canonicalize to Itapetuna");
        check("Nova Macaé".equals(GtoCityTextResolver.uniqueOfficialCanonicalCandidate("Nova Macae", official)),
            "accent-less exact normalized match must use official spelling");
        check("Nova Macaé".equals(GtoCityTextResolver.uniqueOfficialCanonicalCandidate("Nova Mocaé", official)),
            "one-edit Nova Mocaé OCR variant must canonicalize to Nova Macaé");
        check("Águas Velhas".equals(GtoCityTextResolver.uniqueOfficialCanonicalCandidate("Aguas Velhas", official)),
            "official accents must be restored from the closed GTO city universe");
        check(GtoCityTextResolver.uniqueOfficialCanonicalCandidate("Cidade Inventada", official).isEmpty(),
            "unknown destination must not be invented or normalized");

        List<String> ambiguous = Arrays.asList("Cidade Alfa", "Cidade Alga");
        check(GtoCityTextResolver.uniqueOfficialCanonicalCandidate("Cidade Alha", ambiguous).isEmpty(),
            "two equally close official destinations must remain ambiguous");

        GtoKnownDestinationPolicy.Resolution sameTypo = GtoKnownDestinationPolicy.resolveSelectedRow(
            "Itopetuna", "Itopetuna", official
        );
        check(sameTypo.resolved && "Itapetuna".equals(sameTypo.value),
            "matching selected-row typo evidence must canonicalize safely");

        GtoKnownDestinationPolicy.Resolution preciseOnly = GtoKnownDestinationPolicy.resolveSelectedRow(
            "Itopetuna", "", official
        );
        check(preciseOnly.resolved && "Itapetuna".equals(preciseOnly.value),
            "human-backed precise selected-row OCR may use a unique official city");

        GtoKnownDestinationPolicy.Resolution conflict = GtoKnownDestinationPolicy.resolveSelectedRow(
            "Itopetuna", "Registro", official
        );
        check(!conflict.resolved,
            "conflicting official destinations must never be silently normalized");

        GtoKnownDestinationPolicy.Resolution unknownPrecise = GtoKnownDestinationPolicy.resolveSelectedRow(
            "Cidade Inventada", "Itapetuna", official
        );
        check(!unknownPrecise.resolved,
            "older baseline must never override an unknown precise selected-row destination");

        GtoKnownDestinationPolicy.Resolution retry = GtoKnownDestinationPolicy.resolveRetry(
            "Itopetuna", "Itapetuna", official
        );
        check(retry.resolved && "Itapetuna".equals(retry.value),
            "focused retry one-edit OCR may confirm the same unique official destination");

        check("Itapetuna".equals(GtoCityTextResolver.uniqueOfficialCanonicalCandidate(
            "Itopetuna", Collections.emptyList()
        )), "embedded approved destinations remain available without web context");

        System.out.println("PASS HF28 known destination policy");
    }

    private static void check(boolean ok, String message) {
        if (!ok) throw new AssertionError(message);
    }
}
