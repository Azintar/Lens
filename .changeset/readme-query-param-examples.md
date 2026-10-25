---
'lens': patch
---

The generated README endpoint table now appends a worked query string built from the `example:` values of each route's required query parameters in `openapi.yaml` (e.g. `/v1/basket?asset=XLM&asset=USDC&weight=0.6&weight=0.4`), so rows stay copy-pasteable without hand-maintained paths.
