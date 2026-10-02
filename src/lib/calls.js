// Voice & video calls over WebRTC. Signalling rides on 2qo's encrypted envelopes, so calls
// work over any link: a direct phone-to-phone link or mesh (no data at all), the LAN hub,
// or (for testing) two tabs. Media flows directly between the phones on the same Wi-Fi/hotspot.
//
// "Play my song": during a call either person can play songs from their phone. The song is
// mixed with their microphone (Web Audio) and replaces the outgoing audio track, so both people
// hear the same music live and can keep talking over it.
import { getState, setState, toast } from './store.js';
import { send, onCallSignal, logCall, displayName, reachability } from './core.js';
import { uid } from './crypto.js';

let pc = null;
let local = null;
let pendingIce = [];
let ringTimer = null;
let dropTimer = null;
let music = null;

function rtcConfig() {
  // With no internet, host candidates on the shared Wi-Fi/hotspot are all we need.
  // A public STUN server is only added when online (it is harmless if unreachable).
  return { iceServers: navigator.onLine ? [{ urls: 'stun:stun.l.google.com:19302' }] : [], iceCandidatePoolSize: 2 };
}

function set(patch) {
  setState((s) => ({ call: s.call ? { ...s.call, ...patch } : null }));
}

function newPeer(peerId, callId) {
  pc = new RTCPeerConnection(rtcConfig());
  pc.onicecandidate = (e) => e.candidate && send(peerId, { k: 'call-ice', callId, cand: e.candidate.toJSON() });
  pc.ontrack = (e) => set({ remote: e.streams[0] || new MediaStream([e.track]) });
  pc.onconnectionstatechange = () => {
    const st = pc?.connectionState;
    if (st === 'connected') {
      clearTimeout(dropTimer);
      dropTimer = null;
      set({ state: 'connected', connectedAt: getState().call?.connectedAt || Date.now(), weak: false });
    }
    // Wi-Fi blips are common on hotspots: give the link a few seconds to recover before hanging up
    if (st === 'disconnected') {
      set({ weak: true });
      clearTimeout(dropTimer);
      dropTimer = setTimeout(() => pc?.connectionState !== 'connected' && end('Connection lost'), 10000);
    }
    if (st === 'failed') end('Connection lost');
  };
  return pc;
}

async function media(video) {
  return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: video ? { facingMode: 'user', width: { ideal: 640 } } : false });
}

export async function startCall(peerId, video = false) {
  if (getState().call) return toast('Already in a call');
  const reach = reachability(peerId);
  const callId = uid(8);
  setState({ call: { id: callId, peer: peerId, video, dir: 'out', state: 'calling', startedAt: Date.now(), muted: false, camOff: false, via: reach.via, unreachable: !reach.ok } });
  try {
    local = await media(video);
  } catch {
    setState({ call: null });
    return toast('Microphone/camera permission is needed for calls');
  }
  set({ local });
  newPeer(peerId, callId);
  local.getTracks().forEach((t) => pc.addTrack(t, local));
  await pc.setLocalDescription(await pc.createOffer());
  const ok = await send(peerId, { k: 'call-offer', callId, sdp: pc.localDescription.sdp, video });
  if (!ok || !reach.ok) set({ note: `${displayName(peerId)} isn’t linked right now`, unreachable: true });
  ringTimer = setTimeout(() => getState().call?.state === 'calling' && end('No answer'), 45000);
}

export async function acceptCall() {
  const c = getState().call;
  if (!c || c.dir !== 'in') return;
  try {
    local = await media(c.video);
  } catch {
    return reject();
  }
  set({ local, state: 'connecting' });
  local.getTracks().forEach((t) => pc.addTrack(t, local));
  await pc.setLocalDescription(await pc.createAnswer());
  send(c.peer, { k: 'call-answer', callId: c.id, sdp: pc.localDescription.sdp });
}

export function reject() {
  const c = getState().call;
  if (!c) return;
  send(c.peer, { k: 'call-reject', callId: c.id });
  finish(c, 'declined');
}

export function end(reason) {
  const c = getState().call;
  if (!c) return;
  send(c.peer, { k: 'call-end', callId: c.id });
  finish(c, c.connectedAt ? 'ended' : c.dir === 'in' ? 'missed' : reason === 'No answer' ? 'no answer' : 'cancelled');
  if (reason) toast(reason);
}

function finish(c, outcome) {
  clearTimeout(ringTimer);
  clearTimeout(dropTimer);
  stopMusic({ silent: true });
  local?.getTracks().forEach((t) => t.stop());
  pc?.close();
  pc = null;
  local = null;
  pendingIce = [];
  logCall({ id: c.id, peer: c.peer, dir: c.dir, video: c.video, ts: c.startedAt, duration: c.connectedAt ? Math.round((Date.now() - c.connectedAt) / 1000) : 0, outcome });
  setState({ call: null });
}

export function toggleMute() {
  const c = getState().call;
  // mutes only your voice — shared music keeps playing
  local?.getAudioTracks().forEach((t) => (t.enabled = c.muted));
  set({ muted: !c.muted });
}

export function toggleCam() {
  const c = getState().call;
  local?.getVideoTracks().forEach((t) => (t.enabled = c.camOff));
  set({ camOff: !c.camOff });
}

export async function flipCam() {
  const track = local?.getVideoTracks()[0];
  if (!track) return;
  const facing = track.getSettings().facingMode === 'user' ? 'environment' : 'user';
  const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing } });
  const nt = s.getVideoTracks()[0];
  pc.getSenders().find((x) => x.track?.kind === 'video')?.replaceTrack(nt);
  track.stop();
  local.removeTrack(track);
  local.addTrack(nt);
  set({ local: new MediaStream(local.getTracks()) });
}

// ------------------------------------------------------------ shared music --

function musicState() {
  if (!music) return null;
  const t = music.queue[music.idx];
  return {
    title: t?.title || '',
    playing: !music.el.paused,
    pos: music.el.currentTime || 0,
    dur: isFinite(music.el.duration) ? music.el.duration : t?.dur || 0,
    idx: music.idx,
    count: music.queue.length,
    volume: music.musicGain.gain.value,
    queue: music.queue.map((q) => q.title),
  };
}

function publishMusic(force) {
  const c = getState().call;
  if (!c || !music) return;
  const m = musicState();
  set({ music: m });
  const now = Date.now();
  if (force || now - (music.lastSent || 0) > 2000) {
    music.lastSent = now;
    send(c.peer, { k: 'call-music', callId: c.id, title: m.title, playing: m.playing, pos: m.pos, dur: m.dur, idx: m.idx, count: m.count });
  }
}

async function setupMixer() {
  const sender = pc.getSenders().find((s) => s.track?.kind === 'audio');
  const micTrack = local.getAudioTracks()[0];
  if (!sender || !micTrack) throw new Error('No audio in this call');
  const ctx = new AudioContext({ latencyHint: 'interactive' });
  await ctx.resume();
  const dest = ctx.createMediaStreamDestination();
  const micSrc = ctx.createMediaStreamSource(new MediaStream([micTrack]));
  const micGain = ctx.createGain();
  micSrc.connect(micGain).connect(dest);
  const el = new Audio();
  el.preload = 'auto';
  const src = ctx.createMediaElementSource(el);
  const musicGain = ctx.createGain();
  musicGain.gain.value = 0.85;
  src.connect(musicGain);
  musicGain.connect(dest); // → the other person
  const monitor = ctx.createGain();
  monitor.gain.value = 0.9;
  musicGain.connect(monitor).connect(ctx.destination); // → you
  await sender.replaceTrack(dest.stream.getAudioTracks()[0]);
  // give the music some bandwidth (voice defaults are tuned for speech)
  try {
    const p = sender.getParameters();
    p.encodings = p.encodings?.length ? p.encodings : [{}];
    p.encodings[0].maxBitrate = 128000;
    await sender.setParameters(p);
  } catch {}
  el.onended = () => (music.idx < music.queue.length - 1 ? playTrack(music.idx + 1) : (publishMusic(true), set({ music: musicState() })));
  el.ontimeupdate = () => publishMusic(false);
  el.onplay = el.onpause = () => publishMusic(true);
  el.onloadedmetadata = () => publishMusic(true);
  music = { ctx, dest, el, micGain, musicGain, monitor, sender, micTrack, queue: [], idx: 0 };
}

/** Add songs (File objects from the phone) to the shared queue and start playing. */
export async function shareMusic(files) {
  const c = getState().call;
  if (!c || !pc || !local) return toast('Start a call first');
  if (c.state !== 'connected') return toast('Wait for the call to connect');
  const list = [...files].filter((f) => f.type.startsWith('audio/') || /\.(mp3|m4a|aac|wav|ogg|opus|flac|webm)$/i.test(f.name));
  if (!list.length) return toast('Pick a song file (mp3, m4a, wav, ogg…)');
  try {
    if (!music) await setupMixer();
  } catch (e) {
    return toast(e.message);
  }
  const wasEmpty = !music.queue.length || music.el.ended;
  for (const f of list) music.queue.push({ title: f.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' '), url: URL.createObjectURL(f) });
  if (wasEmpty) await playTrack(music.queue.length - list.length);
  else publishMusic(true);
  toast(list.length > 1 ? `${list.length} songs added — both of you can hear them` : 'Playing for both of you 🎵');
}

export async function playTrack(i) {
  if (!music || !music.queue[i]) return;
  music.idx = i;
  music.el.src = music.queue[i].url;
  try {
    await music.el.play();
  } catch (e) {
    toast('Can’t play this file: ' + e.message);
  }
  publishMusic(true);
}

export function toggleMusic() {
  if (!music) return;
  music.el.paused ? music.el.play() : music.el.pause();
}

export function seekMusic(pos) {
  if (!music) return;
  music.el.currentTime = pos;
  publishMusic(true);
}

export function nextTrack(dir = 1) {
  if (!music) return;
  const i = music.idx + dir;
  if (i >= 0 && i < music.queue.length) playTrack(i);
}

export function musicVolume(v) {
  if (!music) return;
  music.musicGain.gain.value = v;
  set({ music: musicState() });
}

export function stopMusic({ silent = false } = {}) {
  if (!music) return;
  const m = music;
  music = null;
  m.el.pause();
  m.el.removeAttribute('src');
  m.queue.forEach((q) => URL.revokeObjectURL(q.url));
  if (pc && m.micTrack.readyState === 'live') m.sender.replaceTrack(m.micTrack).catch(() => {});
  m.ctx.close().catch(() => {});
  const c = getState().call;
  if (c && !silent) {
    send(c.peer, { k: 'call-music', callId: c.id, stopped: true });
    set({ music: null });
  }
}

// ------------------------------------------------------------- signalling --
onCallSignal(async (from, d) => {
  const c = getState().call;
  switch (d.k) {
    case 'call-offer':
      if (c) return send(from, { k: 'call-reject', callId: d.callId, busy: true });
      setState({ call: { id: d.callId, peer: from, video: d.video, dir: 'in', state: 'ringing', startedAt: Date.now(), via: reachability(from).via } });
      newPeer(from, d.callId);
      await pc.setRemoteDescription({ type: 'offer', sdp: d.sdp });
      for (const cand of pendingIce) await pc.addIceCandidate(cand).catch(() => {});
      pendingIce = [];
      navigator.vibrate?.([400, 200, 400, 200, 400]);
      ringTimer = setTimeout(() => getState().call?.state === 'ringing' && finish(getState().call, 'missed'), 45000);
      return;
    case 'call-answer':
      if (!c || c.id !== d.callId || !pc) return;
      clearTimeout(ringTimer);
      set({ state: 'connecting', unreachable: false, note: null });
      await pc.setRemoteDescription({ type: 'answer', sdp: d.sdp });
      for (const cand of pendingIce) await pc.addIceCandidate(cand).catch(() => {});
      pendingIce = [];
      return;
    case 'call-ice':
      if (!pc || !pc.remoteDescription) pendingIce.push(d.cand);
      else await pc.addIceCandidate(d.cand).catch(() => {});
      return;
    case 'call-reject':
      if (c?.id === d.callId) {
        finish(c, d.busy ? 'busy' : 'declined');
        toast(d.busy ? `${displayName(from)} is on another call` : 'Call declined');
      }
      return;
    case 'call-end':
      if (c?.id === d.callId) finish(c, c.connectedAt ? 'ended' : 'missed');
      return;
    case 'call-music':
      if (c?.id !== d.callId || from !== c.peer) return;
      if (d.stopped) return set({ remoteMusic: null });
      set({ remoteMusic: { title: d.title, playing: d.playing, pos: d.pos, dur: d.dur, idx: d.idx, count: d.count, at: Date.now() } });
      if (d.playing && !c.remoteMusic) toast(`🎵 ${displayName(from)} is playing “${d.title}” for you`);
  }
});
