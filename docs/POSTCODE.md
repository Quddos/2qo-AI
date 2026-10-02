# Nigeria's National Digital Alphanumeric Postcode, and how 2qo uses it

> Research note (Oct 2026). NIPOST hosts its documentation at https://docs.postcode.gov.ng. That host was not reachable from the build environment, so the API details below were cross-checked against the community Go SDK [abcubed3/postcode](https://github.com/abcubed3/postcode). That SDK says it was built to match the official NIPOST OpenAPI spec. **Verify these details against the official docs before going to production.**

## What it is

The Federal Ministry of Communications, Innovation & Digital Economy and NIPOST launched the system around 1 October 2026. Every building gets a code with five segments:

```
AA 99 H77 BB 55        e.g. EK 01 A03 FK 01
│  │  │   │  └ building unit within the area (2 digits)
│  │  │   └─── area within the district (2 letters)
│  │  └─────── district within the LGA (3 alphanumeric)
│  └────────── LGA within the state (2 digits)
└───────────── state (2 letters)
```

The code has 11 significant characters. The docs call it "12-character", which presumably counts a separator. Canonical form: `EK-01-A03-FK-01`. Display form: `EK 01 A03 FK 01`.

## Is it "open source"?

**The API is open for developers to integrate, but that does not make the system open source.** As far as public information shows:
- Search and Level 1 lookup are **free**.
- Level 2 and above (street, building and geometry detail) need an API key and **consume paid credits**. Level 5 is restricted.

Getting access involves an organisation account, KYB, requesting an access level, staging tokens, UAT with NIPOST where required, and then production tokens. There is no public dataset or source code.

## API (base `https://api.postcode.gov.ng`, header `X-API-Key`)

| Endpoint | Purpose |
|---|---|
| `GET /v1/lookup?code=&level=` | graded lookup (L1 free → L5 restricted) |
| `GET /v1/search/autocomplete?q=` | segment-aware suggestions |
| `GET /v1/search/nearby?lat=&lng=&radius=` | units within ≤300 m |
| `GET /v1/search/reverse?lat=&lng=&max_distance_m=` | snap a coordinate to the nearest unit (default 25 m) |
| `POST /v1/assembly/assemble` · `GET /v1/assembly/disassemble?code=` | segments ↔ code |

Rate limits are reported in the `X-RateLimit-*` headers, and the API returns 429 with `Retry-After` when you exceed them.

## How 2qo uses it (`src/lib/postcode/`)

- **Offline validator and formatter** (`format.js`): parse, assemble, progressive formatting while typing, pulling a postcode out of speech, and hierarchical proximity (same building/area/district/LGA/state). This proximity check drives "people near me" without sharing exact location.
- **API client with an IndexedDB cache** (`client.js`): every response is cached, so lookups and "where am I" keep working offline. If the API can't be reached, the app falls back to on-device validation.
- **Hub proxy** `/api/postcode/*`: keeps the API key off phones and avoids browser CORS limits. It is still unconfirmed whether the gateway allows CORS.
- **SOS**: the alert carries the postcode, GPS and a map link. Nearest stations come from OpenStreetMap (cached for offline use) or from station accounts the user has explicitly marked as trusted.

## Roadmap ideas: the agentic AI

1. **Verified service accounts.** NIPOST or the police could sign station identities so they don't have to be trusted by hand. Station locations could also be bundled per state for fully offline use.
2. **Multimodal on-device models.** Use the camera (and microphone, where the browser supports it) with Gemini Nano or WebLLM vision models to describe a scene, read signs or triage an incident. The agent would then pick the right tool.
3. **Native wrapper (Capacitor).** Unlocks background wake word, Wi-Fi Direct/BLE mesh without QR pairing, SMS fallback without user taps, and a lock-screen SOS.
4. **Commerce, transport and health.** Postcode-addressed deliveries, ride pickup at an exact building unit, and clinic referrals.
5. **Streaming.** Live video to trusted contacts during an SOS once a hub or internet link is available.
