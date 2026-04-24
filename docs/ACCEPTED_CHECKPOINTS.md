# ACCEPTED_CHECKPOINTS.md

## Accepted checkpointid

### 1. Initial governance baseline
**Staatus:** accepted

Sisu:
- 4-failine minimaalne truth-layer on defineeritud
- canonical docs mudel on valitud
- Pass 1 on docs-only

### 2. Current app baseline
**Staatus:** accepted

Sisu:
- AnniVibe v1 scope on fikseeritud:
  - Kodu
  - Buss
  - Loo
  - Päevik
  - Tugi
  - Seaded
- Trendid ja Loo oma trend on v1-st väljas
- `src/` on canonical app baseline
- build ja dev on varem lokaalselt töötanud
- `/api/ullata` route eksisteerib
- joonistamise nippide runtime target on 17
- saved places shape on `{ name, address, lat, lon }`

## Accepted not-yet-done areas

Need on teadaolevad puuduvad või lõpetamata osad, aga ei ava automaatselt uut scope’i:

- päris geokoodingu tee aadress -> koordinaadid
- lõplik mobiili QA
- lõplik deploy pass
- osa richer content directionitest on future/later piirialal

## Rejected / quarantine

### 1. Trends in v1
**Staatus:** rejected current scope jaoks

Põhjus:
- teadlikult v1-st väljas
- scope drift risk

### 2. Broad refactor / backend direction rewrite
**Staatus:** quarantine

Põhjus:
- vastuolus kitsa-passilise töökorraldusega
- nõuab eraldi locki

## Praegune aktiivne faas

- docs-only governance bootstrap -> docs-only codebase mapping

## Järgmine lubatud samm

- `CODEBASE_MAP.md`
- vajadusel `CHANGE_SURFACES.md`

## Implementation pass status

- uus implementation pass EI OLE veel avatud
- enne järgmist päris koodimuudatust peab Pass 2 lõppema ja tekkima uus kitsas lock
