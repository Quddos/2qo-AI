// Direct device-to-device links over WebRTC DataChannels.
// Signalling is done by hand (QR code or copy/paste), so two phones on the same
// Wi-Fi or hotspot can talk with NO internet and NO server. Connected peers also
// relay envelopes for each other, forming a small mesh.
const CHUNK = 15000;
const MAX_HOPS = 4;
const HEARTBEAT = 25000;

async function pack(obj) {
  const json = JSON.stringify(obj);
  if (typeof CompressionStream === 'undefined') return 'J' + btoa(unescape(encodeURIComponent(json)));
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const buf = new Uint8Array(await new Response(stream).arrayBuffer());
  let s = '';
  buf.forEach((b) => (s += String.fromCharCode(b)));
  return 'Z' + btoa(s);
}

async function unpack(str) {
  str = String(str).trim();
  const kind = str[0];
  const body = str.slice(1);
  if (kind === 'J') return JSON.parse(decodeURIComponent(escape(atob(body))));
  const bytes = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return JSON.parse(await new Response(stream).text());
}

function iceServers() {
  // Offline/LAN: host candidates are enough. Online: add public STUN for NAT traversal.
  return navigator.onLine ? [{ urls: 'stun:stun.l.google.com:19302' }] : [];
}

function waitIce(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((res) => {
    const t = setTimeout(res, 4000);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(t);
        res();
      }
    });
  });
}

export function createP2P({ onEnvelope, onAnnounce, onStatus }) {
  const links = new Map(); // linkId -> { pc, dc, peerId, name }
  const relayed = new Map(); // profileId -> last relay time
  const known = new Map(); // profileId -> { profile, hops, at } — who is reachable through the mesh
  let me = null;
  // heartbeat keeps mesh presence fresh and lets newly linked phones learn about everyone
  setInterval(() => {
    if (!me) return;
    for (const l of links.values()) if (l.dc?.readyState === 'open') sendRaw(l.dc, { t: 'announce', profile: me, hops: 0 });
  }, HEARTBEAT);

  function emit() {
    onStatus?.(
      [...links.values()].filter((l) => l.dc?.readyState === 'open').map((l) => ({ id: l.peerId, name: l.name })),
    );
  }

  function wire(link, dc) {
    link.dc = dc;
    const parts = new Map();
    dc.onopen = () => {
      sendRaw(dc, { t: 'announce', profile: me, hops: 0 });
      // introduce the new phone to everyone we already know (fresh in the last 2 minutes)
      for (const k of known.values()) if (Date.now() - k.at < 120000 && k.hops + 1 <= MAX_HOPS) sendRaw(dc, { t: 'announce', profile: k.profile, hops: k.hops + 1 });
      emit();
    };
    dc.onclose = () => {
      links.delete(link.id);
      emit();
    };
    link.pc.addEventListener('connectionstatechange', () => {
      if (['failed', 'closed'].includes(link.pc.connectionState)) {
        links.delete(link.id);
        emit();
      }
    });
    dc.onmessage = (e) => {
      let d = JSON.parse(e.data);
      if (d.t === 'c') {
        const arr = parts.get(d.id) || [];
        arr[d.i] = d.d;
        parts.set(d.id, arr);
        if (arr.filter(Boolean).length < d.n) return;
        parts.delete(d.id);
        d = JSON.parse(arr.join(''));
      }
      if (d.t === 'announce') {
        const hops = d.hops || 0;
        if (hops === 0) {
          link.peerId = d.profile.id;
          link.name = d.profile.name;
          emit();
        }
        if (d.profile?.id === me?.id) return;
        known.set(d.profile.id, { profile: d.profile, hops, at: Date.now() });
        onAnnounce(d.profile, hops === 0 ? 'p2p' : 'mesh');
        // mesh discovery: tell our other links about this phone, so pairing with ONE phone
        // joins you to everyone it's linked to (bounded hops, rate-limited per profile)
        const last = relayed.get(d.profile.id) || 0;
        if (hops < MAX_HOPS && Date.now() - last > 10000) {
          relayed.set(d.profile.id, Date.now());
          for (const l of links.values()) if (l !== link && l.dc?.readyState === 'open') sendRaw(l.dc, { t: 'announce', profile: d.profile, hops: hops + 1 });
        }
      } else if (d.t === 'env') onEnvelope(d.env, 'p2p', link.id);
    };
  }

  function sendRaw(dc, obj) {
    const s = JSON.stringify(obj);
    if (s.length <= CHUNK) return dc.send(s);
    const id = Math.random().toString(36).slice(2);
    const n = Math.ceil(s.length / CHUNK);
    for (let i = 0; i < n; i++) dc.send(JSON.stringify({ t: 'c', id, i, n, d: s.slice(i * CHUNK, (i + 1) * CHUNK) }));
  }

  return {
    name: 'p2p',
    get up() {
      return [...links.values()].some((l) => l.dc?.readyState === 'open');
    },
    start(profile) {
      me = profile;
    },
    announce(profile) {
      me = profile;
      for (const l of links.values()) if (l.dc?.readyState === 'open') sendRaw(l.dc, { t: 'announce', profile });
    },
    /** Step 1 (device A): returns an invite code to show as QR / share. */
    async createInvite() {
      const id = Math.random().toString(36).slice(2);
      const pc = new RTCPeerConnection({ iceServers: iceServers() });
      const link = { id, pc };
      links.set(id, link);
      wire(link, pc.createDataChannel('2qo', { ordered: true }));
      await pc.setLocalDescription(await pc.createOffer());
      await waitIce(pc);
      const code = await pack({ t: 'offer', id, sdp: pc.localDescription.sdp, from: me?.name });
      return { id, code };
    },
    /** Step 2 (device B): accept an invite, returns the answer code to show back. */
    async acceptInvite(code) {
      const offer = await unpack(code);
      if (offer.t !== 'offer') throw new Error('That is not a 2qo invite code');
      const pc = new RTCPeerConnection({ iceServers: iceServers() });
      const link = { id: offer.id, pc };
      links.set(offer.id, link);
      pc.ondatachannel = (e) => wire(link, e.channel);
      await pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await waitIce(pc);
      return { from: offer.from, code: await pack({ t: 'answer', id: offer.id, sdp: pc.localDescription.sdp }) };
    },
    /** Step 3 (device A): complete the link with B's answer code. */
    async completeInvite(code) {
      const ans = await unpack(code);
      const link = links.get(ans.id);
      if (ans.t !== 'answer' || !link) throw new Error('This reply code does not match an open invite');
      await link.pc.setRemoteDescription({ type: 'answer', sdp: ans.sdp });
    },
    send(env, exceptLinkId) {
      let any = false;
      for (const l of links.values()) {
        if (l.id === exceptLinkId || l.dc?.readyState !== 'open') continue;
        sendRaw(l.dc, { t: 'env', env });
        any = true;
      }
      return any;
    },
    peers() {
      return [...links.values()].filter((l) => l.dc?.readyState === 'open').map((l) => ({ id: l.peerId, name: l.name }));
    },
    closeAll() {
      for (const l of links.values()) l.pc.close();
      links.clear();
      emit();
    },
  };
}
