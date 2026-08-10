# RFC 3161 test fixtures

- `data.bin` — fixed input string `captivo-external-anchor-fixture`.
- `digest.hex` — `sha256(data.bin)` in hex; this is the message imprint the token attests.
- `response.tsr` — a real RFC 3161 `TimeStampResp` from freetsa.org over `data.bin`
  (PKIStatus granted). Generated once with:

  ```
  printf 'captivo-external-anchor-fixture' > data.bin
  openssl ts -query -data data.bin -sha256 -cert -no_nonce -out request.tsq
  curl -H "Content-Type: application/timestamp-query" --data-binary @request.tsq https://freetsa.org/tsr -o response.tsr
  openssl dgst -sha256 data.bin | awk '{print $NF}' > digest.hex
  ```

Tests parse the response, extract the token + genTime, and verify the token
against `digest.hex` (must pass) and against a wrong digest (must fail).
