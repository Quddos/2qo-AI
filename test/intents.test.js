import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIntent, matchContact } from '../src/lib/ai/intents.js';

const cases = [
  ['record my situation and send it to the nearest police station', 'sos', { service: 'police', mode: 'video' }],
  ['Hey record audio of this and alert the police', 'sos', { mode: 'audio' }],
  ['help me there is fire', 'sos', { service: 'fire' }],
  ['SOS accident bleeding', 'sos', { service: 'hospital' }],
  ['where is the nearest hospital', 'nearest', { kind: 'hospital' }],
  ['police station near me', 'nearest', { kind: 'police' }],
  ['who is around my area', 'people_nearby', {}],
  ["what's my postcode", 'my_postcode', {}],
  ['check LA 11 W06 TC 10', 'lookup_postcode', { code: 'LA-11-W06-TC-10' }],
  ['send Ada a message that I am on my way', 'send_message', { to: 'Ada', text: 'I am on my way' }],
  ['tell Bayo that the meeting has moved', 'send_message', { to: 'Bayo', text: 'the meeting has moved' }],
  ['message mum: buy bread', 'send_message', { to: 'mum', text: 'buy bread' }],
  ['call Chika', 'call', { to: 'chika', video: false }],
  ['video call mum', 'call', { to: 'mum', video: true }],
  ['record a voice note to Tunde for 20 seconds', 'voice_note', { to: 'tunde', seconds: 20 }],
  ['read my messages', 'read_unread', {}],
  ['post status: market day!', 'post_status', { text: 'market day' }],
  ['open settings', 'open', { screen: 'settings' }],
  ['what do you see', 'look', {}],
  ['what can you do', 'help', {}],
];

for (const [input, tool, args] of cases) {
  test(input, () => {
    const r = parseIntent(input);
    assert.ok(r, 'no intent');
    assert.equal(r.tool, tool);
    for (const [k, v] of Object.entries(args)) assert.equal(r.args[k], v, k);
  });
}

test('contact fuzzy match', () => {
  const cs = [{ id: 1, name: 'Ada Obi' }, { id: 2, name: 'Bayo Adeyemi' }, { id: 3, name: 'Mum', alias: 'Mummy' }];
  assert.equal(matchContact('ada', cs).id, 1);
  assert.equal(matchContact('bayoo', cs).id, 2);
  assert.equal(matchContact('my mum', cs).id, 3);
  assert.equal(matchContact('zed', cs), null);
});
