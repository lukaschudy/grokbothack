import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeVenues, eventKind, extractPostcode, inLondon, isUsableVenueName, lit, parseDevpostDates, scoreEvent, uuidFrom, venueKind, type RawEvent } from './lib.ts';

const ev = (id: string, venue: RawEvent['venue'], extra: Partial<RawEvent> = {}): RawEvent => ({
  id, source: 'luma', title: 'Talk', startsAt: '2026-10-29T18:30:00Z', hostNames: [], online: false, venue, ...extra,
});

test('uuidFrom is deterministic and uuid-shaped', () => {
  assert.equal(uuidFrom('place:abc'), uuidFrom('place:abc'));
  assert.match(uuidFrom('x'), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test('extractPostcode finds UK postcodes', () => {
  assert.equal(extractPostcode('210 Pentonville Rd London N1 9JY United Kingdom'), 'N1 9JY');
  assert.equal(extractPostcode('Aldgate House, 33 Aldgate High St, London, EC3N 1DL'), 'EC3N 1DL');
  assert.equal(extractPostcode('155 Bishopsgate'), undefined);
});

test('inLondon rejects London, Ontario and St Albans', () => {
  assert.equal(inLondon(51.5263, -0.0878), true);
  assert.equal(inLondon(42.98, -81.25), false);
  assert.equal(inLondon(51.75, -0.34), false);
});

test('generic venue names are unusable', () => {
  assert.equal(isUsableVenueName('London'), false);
  assert.equal(isUsableVenueName('Online event'), false);
  assert.equal(isUsableVenueName('Snyk London (Mainframe Building, Floor 3)'), true);
});

test('venueKind', () => {
  assert.equal(venueKind('The Bricklayers Arms'), 'pub');
  assert.equal(venueKind('Imperial College London'), 'university');
  assert.equal(venueKind('Kensington Central Library'), 'community_space');
  assert.equal(venueKind('The Loading Bay - at Techspace'), 'bookable');
  assert.equal(venueKind('Snyk London'), 'company_office');
});

test('eventKind', () => {
  assert.equal(eventKind('HACKATHON - Agent Eval Harness'), 'hackathon');
  assert.equal(eventKind('Company Brain Buildathon'), 'hackathon');
  assert.equal(eventKind('Poker Night @ DAS London'), 'networking');
  assert.equal(eventKind('React Foundation Meetup: London'), 'talk');
});

test('scoreEvent ranks a busy free hackathon above paid drinks, with reasons', () => {
  const hack = scoreEvent(ev('a', undefined, { title: 'Data Hackathon', guestCount: 112, paid: false }), 0);
  const drinks = scoreEvent(ev('b', undefined, { title: 'Founder drinks', guestCount: 30, paid: true }), 0);
  assert.ok(hack.score > drinks.score);
  assert.deepEqual(hack.reasons, ['hackathon', '112 going', 'free']);
  assert.ok(drinks.reasons.includes('paid'));
});

test('parseDevpostDates handles single, range and cross-month', () => {
  assert.equal(parseDevpostDates('Sep 12, 2026')?.start, '2026-09-12T09:00:00.000Z');
  assert.equal(parseDevpostDates('Apr 09 - 10, 2016')?.end, '2016-04-10T18:00:00.000Z');
  assert.equal(parseDevpostDates('Oct 31 - Nov 02, 2025')?.end, '2025-11-02T18:00:00.000Z');
  assert.equal(parseDevpostDates('garbage'), undefined);
});

test('dedupeVenues merges same place id and nearby same-name venues, skips junk', () => {
  const events = [
    ev('meetup:1', { name: 'AutogenAI', lat: 51.5309, lng: -0.1186 }),
    ev('luma:1', { name: 'AutogenAI', lat: 51.531, lng: -0.1185, placeId: 'P1' }),
    ev('luma:2', { name: 'AutogenAI HQ', lat: 51.531, lng: -0.1185, placeId: 'P1' }),
    ev('luma:3', { name: 'Granola', lat: 51.52, lng: -0.08, placeId: 'P2' }),
    ev('meetup:2', { name: 'London', lat: 51.5, lng: -0.12 }),
    ev('meetup:3', { name: 'The Goat Inn', lat: 51.75, lng: -0.34 }),
  ];
  const { venues, venueOf } = dedupeVenues(events);
  assert.equal(venues.length, 2);
  assert.equal(venueOf.get('meetup:1'), venueOf.get('luma:1'));
  assert.equal(venueOf.get('luma:2'), venueOf.get('luma:1'));
  assert.equal(venueOf.has('meetup:2'), false);
  assert.equal(venueOf.has('meetup:3'), false);
});

test('lit escapes quotes and arrays', () => {
  assert.equal(lit("King's Cross"), "'King''s Cross'");
  assert.equal(lit(['a', "b'c"]), "array['a','b''c']::text[]");
  assert.equal(lit([]), "'{}'::text[]");
  assert.equal(lit(undefined), 'null');
});
