import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, proximity, formatPartial, activeSegment, extract, assemble } from '../src/lib/postcode/format.js';

test('parses all accepted spellings', () => {
  for (const s of ['EK 01 A03 FK 01', 'EK-01-A03-FK-01', 'ek01a03fk01']) {
    const p = parse(s);
    assert.equal(p.ok, true, s);
    assert.equal(p.canonical, 'EK-01-A03-FK-01');
    assert.equal(p.display, 'EK 01 A03 FK 01');
    assert.deepEqual(p.segments, { state: 'EK', lga: '01', district: 'A03', area: 'FK', unit: '01' });
  }
});

test('rejects malformed codes', () => {
  assert.equal(parse('EK 01 A03 FK').ok, false);
  assert.equal(parse('E1 01 A03 FK 01').ok, false);
  assert.equal(parse('EK 00 A03 FK 01').ok, false);
  assert.equal(parse('EK 01 A03 F1 01').ok, false);
  assert.equal(parse('EK 01 A03 FK 00').ok, false);
  assert.equal(parse('EK 01 A-3 FK 01').ok, false);
});

test('proximity by hierarchy', () => {
  assert.equal(proximity('LA-11-W06-TC-10', 'LA-11-W06-TC-10'), 5);
  assert.equal(proximity('LA-11-W06-TC-10', 'LA-11-W06-TC-11'), 4);
  assert.equal(proximity('LA-11-W06-TC-10', 'LA-11-U34-ZR-63'), 2);
  assert.equal(proximity('LA-11-W06-TC-10', 'KN-31-F82-WJ-80'), 0);
});

test('partial formatting & active segment', () => {
  assert.equal(formatPartial('ek01a'), 'EK 01 A');
  assert.equal(activeSegment('EK 01 A'), 'district');
  assert.equal(activeSegment('EK'), 'lga');
});

test('extract from speech & assemble', () => {
  assert.equal(extract('check la 11 w06 tc 10 for me').canonical, 'LA-11-W06-TC-10');
  assert.equal(extract('nothing here'), null);
  assert.equal(assemble({ state: 'fc', lga: '03', district: 'b06', area: 'ag', unit: '12' }).display, 'FC 03 B06 AG 12');
});
