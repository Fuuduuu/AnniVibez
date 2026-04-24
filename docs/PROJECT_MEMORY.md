# PROJECT_MEMORY.md

## Projekti identiteet

- **Projekt:** AnniVibe
- **Toote tüüp:** Android-first veebirakendus / PWA
- **Sihtkasutaja:** loov 10–13-aastane tüdruk
- **Praegune staatus:** töötav v1 baseline on olemas; käimas on docs-first governance + v1 stabilization enne deployd

## Praegune eesmärk

Hoida AnniVibe v1 kitsas, jälgitav ja deploy-eelseteks kontrollideks valmis.

Põhieesmärgid:
1. Hoida v1 scope lukus
2. Hoida `src/` canonical baasina
3. Viia lõpuni kitsad QA-põhised parandused
4. Valmistada ette mobiili QA ja deploy
5. Vältida scope drift’i

## Kasutuskontekst / sihtplatvorm

- peamine kasutus: mobiil
- tehniline kuju: Vite + React + PWA
- runtime suund: Cloudflare Pages / Pages Functions
- mitte native app

## Aktiivne scope

V1 sees:
- Kodu
- Buss
- Loo
  - Üllata
  - Joonistamise nipid
- Päevik
- Tugi
- Seaded

## Mitteaktiivne scope

Praegu EI OLE fookus:
- Trendid
- Loo oma trend
- suurem backendisuuna muutmine
- uus arhitektuur või nullist redesign
- production-hardening laias mõttes
- SharePoint / Dataverse / tenant suunad
- broad refactor

## Lukustatud otsused

- Äpi nimi on **AnniVibe**
- `src/` on canonical rakenduse baas
- Frontend ei tohi teha direct browser LLM call’i; Üllata käib backend route’i kaudu
- Üllata API tee on `VITE_LOO_API_PATH || /api/ullata`
- Frontendi fallback peab jääma alles, et Üllata UX ei murduks
- Saved places shape on `{ name, address, lat, lon }`
- Bussiloogika kasutab sisemiselt `lat/lon`
- Joonistamise nippide runtime-komplekt peab olema **17**
- Toon peab olema soe, selge, lapsesõbralik, aga mitte beebikas ega koolilik
- Trendid on v1-st väljas

## Arhitektuursed otsused, mida ei tohi lõhkuda

- app shell elab canonical `src/` struktuuris, mitte demo-failides
- PWA skeleton jääb alles
- narrow-pass töökorraldus: docs -> mapping -> väike implementation pass
- olemasolevat v1 scope’i ei laiendata ilma uue lockita

## Olulised andmereeglid

- Üllata response kuju peab jääma stabiilseks
- saved places peab säilitama nime, aadressi ja koordinaadid
- vana shape `{ name, lat, lon }` võib vajada normaliseerimist, aga seda ei tohi vaikides lõhkuda
- joonistamise nippide sisu peab jääma child-friendly struktuuri:
  - `title`
  - `what_it_helps_with`
  - `explanation`
  - `try_this`
  - `make_your_version`

## Olulised UX reeglid

- kasutajale nähtav keel: eesti
- tekst peab olema arusaadav nutikale 10-aastasele
- mitte õpetajalik
- mitte ülemäära sentimentaalne
- mitte admin-paneeli tunnetus
- üks väike nipp või järgmine samm korraga

## Ametlik põhitöövoog

1. Lukusta truth-layer
2. Tee kitsas docs/mapping pass
3. Ava ainult üks väike implementation pass korraga
4. Tee checkpoint
5. Alles siis ava järgmine pass

## Arutatud, aga mitte lukustatud

- päris aadress -> koordinaadid geokoodingu täpne tehniline tee
- “Koos tegemised / Meisterda vanaemaga / Loomadele” eraldi runtime-plokina
- deploy sihtdetailid pärast QA-d

## Future / later

- Trendid
- Loo oma trend
- suurem sisu laiendus peale v1
- laiem production-hardening
- võimalikud hilisemad integratsioonid ja tenant-readiness teemad

## Hooldusreegel

Uuenda seda faili ainult siis, kui muutub vähemalt üks neist:
- v1 scope
- canonical arhitektuuriline truth
- lukustatud andmeshape
- UX põhireegel
- aktiivsest scope’ist midagi viiakse future/later kihti või vastupidi
