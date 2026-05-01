# GTFS Source Discovery

Generated: 2026-05-01T11:23:40.663Z

## Summary

- Checked URLs: 7
- Reachable feeds: 2
- Recommendation: https://eu-gtfs.remix.com/estonia_unified_gtfs.zip
- Note: Recommended based on reachable ZIP-like response and regional-first priority.

## Checked Sources

| url | method used | httpStatus | contentType | contentLength | reachable | notes |
|---|---|---:|---|---:|---|---|
| https://peatus.ee/gtfs/gtfs.zip | HEAD | 200 | text/html; charset=utf-8 | 1311 | true | Redirected to https://peatus.ee/reitti/gtfs/gtfs.zip |
| https://eu-gtfs.remix.com/estonia_unified_gtfs.zip | HEAD | 200 | application/zip | 67236682 | true | - |
| https://eu-gtfs.remix.com/laanevirumaa.zip | HEAD -> GET(range) | 403 | application/xml | n/a | false | HEAD blocked/limited with status 403; tried safe range GET. |
| https://eu-gtfs.remix.com/laane-virumaa.zip | HEAD -> GET(range) | 403 | application/xml | n/a | false | HEAD blocked/limited with status 403; tried safe range GET. |
| https://eu-gtfs.remix.com/läänevirumaa.zip | HEAD -> GET(range) | 403 | application/xml | n/a | false | HEAD blocked/limited with status 403; tried safe range GET. Redirected to https://eu-gtfs.remix.com/l%C3%A4%C3%A4nevirumaa.zip |
| https://eu-gtfs.remix.com/west-viru.zip | HEAD -> GET(range) | 403 | application/xml | n/a | false | HEAD blocked/limited with status 403; tried safe range GET. |
| https://eu-gtfs.remix.com/laane-viru.zip | HEAD -> GET(range) | 403 | application/xml | n/a | false | HEAD blocked/limited with status 403; tried safe range GET. |

## Recommendation for next GTFS coordinate extraction

Use: `https://eu-gtfs.remix.com/estonia_unified_gtfs.zip` (status 200, type application/zip).

Do not download the full GTFS ZIP repeatedly; cache it once for extraction passes.

Next pass: GTFS coordinate extraction / Rakvere stop extract.
