# Route Pattern vs BUS_DATA Compare Report

Generated: 2026-05-01T10:32:40.441Z

## Coverage

- Patterns parsed: 6
- Line numbers: 1, 2, 3, 5
- Stop refs checked: 106
- Unique stop IDs: 80

## Pattern Table

| lineNumber | patternName | sourceFile | stopCount |
|---|---|---|---:|
| 1 | Piira - Näpi - Piira | Liin 1 Piira - Näpi - Piira.txt | 32 |
| 2 | Piira - Lihakombinaat | Liin2 Piira - Lihakombinaat.txt | 14 |
| 3 | Tõrma - Keskväljak - Tõrma | Liin3 Tõrma - Keskväljak - Tõrma.txt | 16 |
| 3 | Tõrma - Koidula - Tõrma | Liin3 Tõrma - Koidula - Tõrma.txt | 15 |
| 5 | Põhjakeskus - Rägavere tee | Liin5 Põhjakeskus - Rägavere tee.txt | 15 |
| 5 | Rägavere tee - Põhjakeskus | Liin5 Rägavere tee - Põhjakeskus.txt | 14 |

## Summary Warnings

- Missing stop IDs from BUS_DATA.by_code: 0
- Group/name mismatches: 0
- Coordinate warnings: 1
- code/displayCodes membership warnings: 0
- Duplicate stop names with multiple stop IDs: 31

## Duplicate Stop-Name Examples

- Õie: 5901010-1, 5901011-1
- Tulika: 5900815-1, 5900816-1
- Kivi: 5900286-1, 5900287-1
- Polikliinik: 5900576-1, 5900577-1
- Kesk: 5900229-1, 5900230-1
- Näpi: 5900507-1, 5900508-1

## Focus Risk Groups

- Õie: occurrences=2, stopIds=[5901010-1, 5901011-1], groups=[Õie], mismatches=0, coordWarnings=0, displayWarnings=0
- Tulika: occurrences=2, stopIds=[5900815-1, 5900816-1], groups=[Tulika], mismatches=0, coordWarnings=0, displayWarnings=0
- Kivi: occurrences=2, stopIds=[5900286-1, 5900287-1], groups=[Kivi], mismatches=0, coordWarnings=0, displayWarnings=0
- Piiri: occurrences=2, stopIds=[5900566-1, 5900567-1], groups=[Piiri], mismatches=0, coordWarnings=0, displayWarnings=0
- Kungla: occurrences=4, stopIds=[5900310-1, 5900311-1], groups=[Kungla], mismatches=0, coordWarnings=0, displayWarnings=0
- Polikliinik: occurrences=6, stopIds=[5900576-1, 5900577-1], groups=[Polikliinik], mismatches=0, coordWarnings=0, displayWarnings=0
- Kesk: occurrences=2, stopIds=[5900229-1, 5900230-1], groups=[Kesk], mismatches=0, coordWarnings=0, displayWarnings=0
- Keskväljak: occurrences=2, stopIds=[5900232-1], groups=[Keskväljak], mismatches=0, coordWarnings=0, displayWarnings=0
- Näpi: occurrences=2, stopIds=[5900507-1, 5900508-1], groups=[Näpi], mismatches=0, coordWarnings=0, displayWarnings=0
- Narva: occurrences=2, stopIds=[5900484-1, 5900485-1], groups=[Narva], mismatches=0, coordWarnings=0, displayWarnings=0
- Kauba: occurrences=2, stopIds=[5900220-1, 5901245-1], groups=[Kauba], mismatches=0, coordWarnings=0, displayWarnings=0
- Raudteejaam: occurrences=2, stopIds=[5900635-1, 5901241-1], groups=[Raudteejaam], mismatches=0, coordWarnings=0, displayWarnings=0
- Haigla: occurrences=2, stopIds=[5900078-1, 5900079-1], groups=[Haigla], mismatches=0, coordWarnings=0, displayWarnings=0
- Tõrma kalmistu: occurrences=4, stopIds=[5900822-1, 5900823-1], groups=[Tõrma kalmistu], mismatches=0, coordWarnings=0, displayWarnings=0

## Group/Name Mismatch Examples

- none

## Coordinate Warning Examples

- line 5 / Põhjakeskus - Rägavere tee seq 6: Aiand (5900013-1) by_code_coord=false group_coord=true

## code/displayCodes Warning Examples

- none

## Direction Pair Audit Note

- Liin 1: Näpi / Narva / Kauba / Raudteejaam / Polikliinik
- Liin 3: Õie / Tulika / Haigla / Tõrma kalmistu
- Liin 5: Kivi / Piiri / Kungla / Polikliinik / Kesk / Teater

This audit establishes route-pattern / direction truth from parsed stop sequences and BUS_DATA mapping checks. It does not validate physical coordinate correctness in real-world geography.
