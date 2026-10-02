// Voice & video calls over WebRTC. Signalling rides on 2qo's encrypted envelopes, so calls
// work over any link: the LAN hub, a direct P2P link, or (for testing) two tabs.
import { getState, setState, toast } from './store.js';
import { send, onCallSignal, logCall, displayName } from './core.js';
import { uid } from './crypto.js';

let pc = null;
let local = null;
let pendingIce = [];
let ringTimer = null;

function rtcConfig() {
  return { iceServers: navigator.onLine ? [{ urls: 'stun:stun.l.google.com:19302' }] : [] };
}

function set(patch) {
  setState((s) => ({ call: s.call ? { ...s.call, ...patch } : null }));
}

function newPeer(peerId, callId) {
  pc = new RTCPeerConnection(rtcConfig());
  pc.onicecandidate = (e) => e.candidate && send(peerId, { k: 'call-ice', callId, cand: e.candidate.toJSON() });
  pc.ontrack = (e) => set({ remote: e.streams[0] });
  pc.onconnectionstatechange = () => {
    if (pc?.connectionState === 'connected') set({ state: 'connected', connectedAt: Date.now() });
    if (['failed', 'disconnected'].includes(pc?.connectionState)) end('Connection lost');
  };
  return pc;
}

async function media(video) {
  return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: video ? { facingMode: 'user', width: { ideal: 640 } } : false });
}

export async function startCall(peerId, video = false) {
  if (getState().call) return toast('Already in a call');
  const callId = uid(8);
  setState({ call: { id: callId, peer: peerId, video, dir: 'out', state: 'calling', startedAt: Date.now(), muted: false, camOff: false } });
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
  if (!ok) set({ note: 'No link to this contact right now — trying…' });
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

onCallSignal(async (from, d) => {
  const c = getState().call;
  switch (d.k) {
    case 'call-offer':
      if (c) return send(from, { k: 'call-reject', callId: d.callId, busy: true });
      setState({ call: { id: d.callId, peer: from, video: d.video, dir: 'in', state: 'ringing', startedAt: Date.now() } });
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
      set({ state: 'connecting' });
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
  }
});
