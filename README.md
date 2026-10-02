# 2qo

2qo is an offline-first messaging app (a PWA) with an on-device voice AI and built-in support for Nigeria's National Digital Alphanumeric Postcode.

It covers the WhatsApp feature set with its own UI: a floating dock, a central AI orb, card-style bubbles and postcode chips. It also keeps working without internet.

## Quick start

```bash
npm install
npm run dev                # http://localhost:5173
# Try several people on one machine: open /?as=ada and /?as=bayo in two tabs
```

To run a community hub on a laptop, Raspberry Pi or Termux, with no internet needed:

```bash
npm run build
HTTPS=1 npm run hub        # serves the app plus relay at https://<lan-ip>:8787
```

The hub uses a self-signed certificate. Phones on the same Wi-Fi or hotspot open the https address and accept the certificate warning once. HTTPS is required because encryption, the microphone and the camera only work in a secure context.

Optional hub environment variables:
- `POSTCODE_API_KEY`: keeps your NIPOST key on the hub
- `PORT`
- `DATA_DIR`
- `TLS_CERT` / `TLS_KEY`

## Features

| Area | What's there |
|---|---|
| Chats | 1:1, groups (admins, only-admins-send, add/remove, leave), broadcast lists, communities with announcement groups, channels (follow by QR), notes-to-self |
| Messages | text, emoji, photos, video, documents, voice notes, location (with postcode), contact cards, polls; reply, react, forward, star, edit (15 min), delete for me/everyone, message info, disappearing messages, typing, ✓/✓✓/read ticks |
| Moments | 24 h text/photo/video statuses, viewers list, replies, privacy (contacts / except / only) |
| Calls | WebRTC voice & video (mute, camera, flip); signalling is encrypted, works on LAN without internet |
| Privacy | E2E encryption (ECDH P-256 + AES-GCM), safety numbers, chat lock PIN, block, last-seen & read-receipt controls, no phone number |
| Settings | themes/accents/font size/wallpapers, notifications, backup export/restore |
| Nearby | people near your postcode (same area → district → LGA → state), police/hospital/fire/pharmacy near you |
| 2qo AI | “Hey 2qo” wake word, voice or text commands that *act*: message, call, voice notes, SOS, find places/people, postcode lookups, read unread, post status, “what do you see” (camera) |
| SOS | record video/audio → GPS → postcode → nearest station → cancellable countdown → encrypted alert to trusted station accounts & emergency contacts + pre-filled SMS/call to 112 |

## How offline works

All data lives in IndexedDB on the device, and the service worker caches the whole app. Messages travel over whichever of these links is available:

1. **Same device:** tabs talk over BroadcastChannel (useful for testing).
2. **Direct phone-to-phone:** a WebRTC data channel, paired by QR code. It needs no server and no internet, only the same Wi-Fi or hotspot. Linked phones also relay messages for each other.
3. **2qo Hub on a LAN:** relay, store-and-forward for offline users, and a postcode-aware directory.
4. **Online:** the same hub, run on a public server.

If no link is up, messages wait in an outbox and send automatically when one becomes available.

The AI runs on the device:
- A deterministic command engine is always available.
- Chrome's built-in Gemini Nano is used where the browser has it, including image input.
- A WebLLM model (Qwen 2.5 1.5B, Llama 3.2 1B or SmolLM2) can be downloaded once and then cached.

Speech uses the platform recognizer. Chrome supports on-device speech packs, and text-to-speech voices are local.

## Tests

```bash
npm test                                      # unit: postcode parser, intent parser
npm run build && npx vite preview --port 4173 &
npm run test:e2e                              # 2 users: chat, receipts, reactions, AI actions, groups, moments, SOS, all screens, offline boot
npm run hub & npm run test:hub                # hub directory, store-and-forward, P2P link with hub switched off
```

For the Nigerian postcode research and the roadmap, see [docs/POSTCODE.md](docs/POSTCODE.md).
