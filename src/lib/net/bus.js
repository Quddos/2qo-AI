// Same-device transport: BroadcastChannel between tabs/windows.
// Lets you run several 2qo profiles side by side (?as=ada, ?as=bayo) with zero network.
export function createBus({ onEnvelope, onAnnounce }) {
  if (typeof BroadcastChannel === 'undefined') return null;
  const ch = new BroadcastChannel('2qo-bus');
  let me = null;
  ch.onmessage = (e) => {
    const d = e.data;
    if (!d || !me) return;
    if (d.t === 'env' && d.env.from !== me.id) onEnvelope(d.env, 'bus');
    if (d.t === 'announce' && d.profile.id !== me.id) {
      onAnnounce(d.profile, 'bus');
      if (d.wantReply) ch.postMessage({ t: 'announce', profile: me });
    }
  };
  return {
    name: 'bus',
    get up() {
      return true;
    },
    start(profile) {
      me = profile;
      ch.postMessage({ t: 'announce', profile, wantReply: true });
    },
    announce(profile) {
      me = profile;
      ch.postMessage({ t: 'announce', profile });
    },
    send(env) {
      ch.postMessage({ t: 'env', env });
      return true;
    },
  };
}
