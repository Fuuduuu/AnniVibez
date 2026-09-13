import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { BUS_DATA } from '../../src/data/busData.js';

const moduleURL = new URL('../../src/utils/busReach.js', import.meta.url);
async function api(data) {
  assert.ok(existsSync(moduleURL), 'Reachability module must exist');
  if (!data) return import(moduleURL.href);
  const source = readFileSync(moduleURL, 'utf8').replace("import { BUS_DATA } from '../data/busData.js';", `const BUS_DATA = ${JSON.stringify(data)};`);
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}
const names = results => results.map(r => r.name).sort();
const expectedOie = ['Haigla', 'Keskuse', 'Lai', 'Lilleoru', 'Pauluse kalmistu', 'Saueaugu', 'Tammiku', 'Tarva', 'Tulika', 'T\u00f5rma kalmistu', 'Vallim\u00e4e', 'Viru', '\u00d6\u00f6biku'].sort();

test('origin contexts expand only explicit group siblings; arrays retain individual requested points', async () => {
  const { createOriginContext } = await api();
  for (const id of ['5901010-1', '5901011-1']) assert.deepEqual(createOriginContext(id), { stopIds: ['5901010-1', '5901011-1'] });
  assert.deepEqual(createOriginContext(['5901011-1']), { stopIds: ['5901011-1'] });
  assert.deepEqual(createOriginContext(['5901011-1', '5900286-1', '5901011-1']), { stopIds: ['5901011-1', '5900286-1'] });
  assert.deepEqual(createOriginContext([]), { stopIds: [] });
});

for (const service of ['E-R', 'L', 'P']) {
  test(`Oie ${service}: exact 13 groups from either sibling; exact 12/2 independent point sets`, async () => {
    const { createOriginContext, reachableDestinations } = await api();
    for (const id of ['5901010-1', '5901011-1']) {
      const result = reachableDestinations(createOriginContext(id), { service });
      assert.equal(result.length, 13);
      assert.deepEqual(names(result), expectedOie);
    }
    const first = reachableDestinations(createOriginContext(['5901010-1']), { service });
    const second = reachableDestinations(createOriginContext(['5901011-1']), { service });
    assert.equal(first.length, 12);
    assert.deepEqual(names(first), expectedOie.filter(name => name !== 'Tammiku'));
    assert.equal(second.length, 2);
    assert.deepEqual(names(second), ['Tammiku', 'T\u00f5rma kalmistu'].sort());
    assert.ok(first.flatMap(r => r.connections).every(c => c.boardStopId === '5901010-1'));
    assert.ok(second.flatMap(r => r.connections).every(c => c.boardStopId === '5901011-1'));
    assert.deepEqual(second.find(r => r.name === 'Tammiku').stopIds, ['5900777-1']);
  });
}

test('Kivi siblings retain independent directions and concrete boarding evidence', async () => {
  const { createOriginContext, reachableDestinations } = await api();
  assert.deepEqual(createOriginContext('5900286-1').stopIds, ['5900286-1', '5900287-1']);
  const one = reachableDestinations(createOriginContext(['5900286-1']), { service: 'E-R' });
  assert.deepEqual(names(one), ['R\u00e4gavere tee']);
  const two = reachableDestinations(createOriginContext(['5900287-1']), { service: 'E-R' });
  assert.equal(two.length, 12);
  assert.ok(two.some(r => r.name === 'P\u00f5hjakeskus'));
  assert.ok(!two.some(r => r.name === 'R\u00e4gavere tee'));
  const together = reachableDestinations(createOriginContext('5900287-1'), { service: 'E-R' });
  assert.deepEqual(names(together), [...names(one), ...names(two)].sort());
  assert.ok(one.flatMap(r => r.connections).every(c => c.boardStopId === '5900286-1'));
  assert.ok(two.flatMap(r => r.connections).every(c => c.boardStopId === '5900287-1'));
});

test('line 2 return reaches all 13 downstream groups only on E-R', async () => {
  const { createOriginContext, reachableDestinations } = await api();
  const context = createOriginContext('5900659-1');
  const result = reachableDestinations(context, { service: 'E-R' });
  assert.equal(result.length, 13);
  assert.deepEqual(names(result), ['Roodev\u00e4lja', 'Papiaru', 'Arkna tee', 'V\u00f5idu', 'Lai', 'Keskuse', 'Polikliinik', 'Seminari', 'Karja', 'Tartu', 'M\u00e4e', 'Palermo', 'Piira'].sort());
  assert.ok(result.every(r => r.lines.length === 1 && r.lines[0] === '2'));
  for (const service of ['L', 'P']) assert.deepEqual(reachableDestinations(context, { service }), []);
});

test('loop origins never return their own logical group and terminal-only points cannot board', async () => {
  const { createOriginContext, reachableDestinations } = await api();
  for (const [id, ownName, validName] of [['5900565-1', 'Piira', 'Palermo'], ['5900823-1', 'T\u00f5rma kalmistu', 'Tammiku']]) {
    const result = reachableDestinations(createOriginContext(id), { service: 'E-R' });
    assert.ok(!result.some(r => r.name === ownName));
    assert.ok(result.some(r => r.name === validName));
  }
  assert.deepEqual(reachableDestinations(createOriginContext(['5900822-1']), { service: 'E-R' }), []);
});

test('duplicate destination groups retain exact reachable IDs, lines and valid same-trip connections', async () => {
  const { createOriginContext, reachableDestinations } = await api();
  const origins = createOriginContext('5900565-1');
  const result = reachableDestinations(origins, { service: 'E-R' });
  assert.equal(new Set(result.map(r => r.name)).size, result.length);
  const polikliinik = result.find(r => r.name === 'Polikliinik');
  assert.deepEqual(polikliinik.lines, ['1', '2']);
  assert.deepEqual(polikliinik.stopIds, ['5900576-1', '5900577-1']);
  for (const destination of result) {
    assert.deepEqual(destination.stopIds, [...new Set(destination.connections.map(c => c.alightStopId))].sort());
    assert.deepEqual(destination.lines, [...new Set(destination.connections.map(c => c.line))].sort());
    assert.equal(new Set(destination.connections.map(c => JSON.stringify(c))).size, destination.connections.length);
    for (const c of destination.connections) {
      const line = BUS_DATA.lines.find(l => l.service === 'E-R' && l.pattern_id === c.patternId && l.line === c.line);
      const trip = line.trips.find(t => t.id === c.tripId);
      assert.ok(origins.stopIds.includes(c.boardStopId));
      assert.equal(trip.visits[c.boardVisitIndex].stopId, c.boardStopId);
      assert.equal(trip.visits[c.alightVisitIndex].stopId, c.alightStopId);
      assert.ok(c.alightVisitIndex > c.boardVisitIndex);
    }
  }
});

function fixture(codes, groups, tripSeqs = codes.map((_, i) => i + 1)) {
  const stops = codes.map((code, i) => ({ code, seq: i + 1 }));
  return { by_code: Object.fromEntries(codes.map(code => [code, { name: 'Unused label' }])), groups,
    patterns: [{ id: 'p', line: 'X', stops, stop_ids: codes }], coverage: { X: { 'E-R': 'SCHEDULED', L: 'NO_SERVICE', P: 'NO_SERVICE' } },
    lines: [{ line: 'X', service: 'E-R', pattern_id: 'p', stops,
      trips: [{ id: 't', dayType: 'E-R', stop_times: tripSeqs.map(seq => ({ seq, time: '08:00' })),
        visits: tripSeqs.map((seq, i) => ({ visitIndex: i, stopId: codes[seq - 1], sourceRows: [seq] })) }] }] };
}

test('group membership, not equal labels or coordinates, determines origin expansion and self exclusion', async () => {
  const data = fixture(['A', 'B', 'C'], [{ name: 'Same label', codes: ['A'] }, { name: 'Same label', codes: ['B'] }, { name: 'Other', codes: ['C'] }]);
  const { createOriginContext, reachableDestinations } = await api(data);
  assert.deepEqual(createOriginContext('A').stopIds, ['A']);
  const result = reachableDestinations(createOriginContext('A'), { service: 'E-R' });
  assert.deepEqual(result.find(r => r.name === 'Same label').stopIds, ['B']);
});

test('no pattern-only, cross-trip or forbidden-service connections are invented', async () => {
  const groups = ['A', 'B', 'C'].map(name => ({ name, codes: [name] }));
  const data = fixture(['A', 'B', 'C'], groups, [1]);
  data.lines[0].trips.push({ id: 'other', dayType: 'E-R', stop_times: [{ seq: 2 }, { seq: 3 }], visits: [{ visitIndex: 0, stopId: 'B', sourceRows: [2] }, { visitIndex: 1, stopId: 'C', sourceRows: [3] }] });
  let core = await api(data);
  assert.deepEqual(core.reachableDestinations(core.createOriginContext('A'), { service: 'E-R' }), []);
  assert.deepEqual(names(core.reachableDestinations(core.createOriginContext('B'), { service: 'E-R' })), ['C']);
  data.coverage.X['E-R'] = 'NO_SERVICE';
  core = await api(data);
  assert.deepEqual(core.reachableDestinations(core.createOriginContext('B'), { service: 'E-R' }), []);
  data.coverage.X['E-R'] = 'SCHEDULED';
  data.patterns[0].line = 'different';
  core = await api(data);
  assert.deepEqual(core.reachableDestinations(core.createOriginContext('B'), { service: 'E-R' }), []);
});

test('explicit multi-row visits remain one occurrence and repeated origin visits are evaluated independently', async () => {
  const data = fixture(['A', 'A', 'B', 'A', 'C', 'A'], ['A', 'B', 'C'].map(name => ({ name, codes: [name] })));
  data.lines[0].trips[0].visits = [{ visitIndex: 0, stopId: 'A', sourceRows: [1, 2] }, { visitIndex: 1, stopId: 'B', sourceRows: [3] }, { visitIndex: 2, stopId: 'A', sourceRows: [4] }, { visitIndex: 3, stopId: 'C', sourceRows: [5] }, { visitIndex: 4, stopId: 'A', sourceRows: [6] }];
  const { createOriginContext, reachableDestinations } = await api(data);
  const result = reachableDestinations(createOriginContext('A'), { service: 'E-R' });
  assert.deepEqual(names(result), ['B', 'C']);
  assert.deepEqual(result.find(r => r.name === 'B').connections.map(c => c.boardVisitIndex), [0]);
  assert.deepEqual(result.find(r => r.name === 'C').connections.map(c => c.boardVisitIndex), [0, 2]);
});

test('explicit service is required; invalid identities fail closed and output is deterministic and detached', async () => {
  const { createOriginContext, reachableDestinations } = await api();
  assert.throws(() => createOriginContext('unknown'), /stop/i);
  assert.throws(() => createOriginContext('Oie'), /stop/i);
  assert.throws(() => createOriginContext({ displayCodes: ['5901010-1'] }), /stop/i);
  const context = createOriginContext('5901010-1');
  assert.throws(() => reachableDestinations(context), /service/i);
  assert.throws(() => reachableDestinations(context, { service: 'holiday' }), /service/i);
  assert.deepEqual(reachableDestinations(createOriginContext([]), { service: 'E-R' }), []);
  const first = reachableDestinations(context, { service: 'E-R' });
  assert.deepEqual(first, reachableDestinations({ stopIds: [...context.stopIds].reverse() }, { service: 'E-R' }));
  first[0].stopIds.length = 0;
  first[0].connections[0].boardStopId = 'modified';
  assert.notDeepEqual(first, reachableDestinations(context, { service: 'E-R' }));
});
