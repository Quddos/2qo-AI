// "2qo Hub" transport: a small relay (server/hub.js) that can run on any laptop,
// Raspberry Pi or phone hotspot on a local network — no internet required.
// Provides presence, a postcode-aware user directory and store-and-forward delivery.
export function createHub({ onEnvelope, onAnnounce, onStatus, onDirectory, onPresence }) {
  let ws = null;
  let url = null;
  let me = null;
  let retry = 0;
  let timer = null;
  let up = false;
  const pending = new Map();

  function setUp(v) {
    up = v;
    onStatus?.(v ? 'connected' : url ? 'connecting' : 'off');
  }

  function connect() {
    clearTimeout(timer);
    if (!url || !me) return;
    try {
      ws = new WebSocket(url);
    } catch {
      return schedule();
    }
    setUp(false);
    ws.onopen = () => {
      retry = 0;
      ws.send(JSON.stringify({ t: 'hello', profile: me }));
      setUp(true);
    };
    ws.onmessage = (e) => {
      let d;
      try {
        d = JSON.parse(e.data);
      } catch {
        return;
      }
      if (d.t === 'env') onEnvelope(d.env, 'hub');
      else if (d.t === 'announce') onAnnounce(d.profile, 'hub');
      else if (d.t === 'presence') onPresence?.(d.id, d.online, d.lastSeen);
      else if (d.t === 'dir') {
        const p = pending.get(d.rid);
        if (p) {
          pending.delete(d.rid);
          p(d.results);
        }
        onDirectory?.(d.results);
      }
    };
    ws.onclose = () => {
      setUp(false);
      schedule();
    };
    ws.onerror = () => ws?.close();
  }

  function schedule() {
    if (!url) return;
    retry = Math.min(retry + 1, 6);
    timer = setTimeout(connect, 1000 * 2 ** retry);
  }

  return {
    name: 'hub',
    get up() {
      return up;
    },
    get url() {
      return url;
    },
    start(profile, hubUrl) {
      me = profile;
      this.setUrl(hubUrl);
    },
    setUrl(u) {
      url = u || null;
      retry = 0;
      if (ws) {
        ws.onclose = null;
        ws.close();
        ws = null;
      }
      setUp(false);
      connect();
    },
    reconnect() {
      if (!up) {
        retry = 0;
        connect();
      }
    },
    announce(profile) {
      me = profile;
      if (up) ws.send(JSON.stringify({ t: 'hello', profile }));
    },
    send(env) {
      if (!up) return false;
      ws.send(JSON.stringify({ t: 'env', env }));
      return true;
    },
    /** Directory search by postcode proximity / name. Resolves [] when offline. */
    search(query) {
      if (!up) return Promise.resolve([]);
      const rid = Math.random().toString(36).slice(2);
      ws.send(JSON.stringify({ t: 'dir', rid, ...query }));
      return new Promise((res) => {
        pending.set(rid, res);
        setTimeout(() => pending.has(rid) && (pending.delete(rid), res([])), 5000);
      });
    },
  };
}

/** Default hub URL: the origin serving the app, if it is a 2qo Hub. */
export function defaultHubUrl() {
  if (typeof location === 'undefined') return null;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/hub`;
}
