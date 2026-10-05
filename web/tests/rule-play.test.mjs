// "Watch it play" (src/ui/rule-play.js): every scene runs headless through the same runner the page uses
// (runScene in src/ui/rule-play-scenes.js → the bundled VM), and every beat must get the verdict its story expects.
// If an example script changes, the story that depends on it fails here instead of silently telling a wrong tale.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as hs from '../src/vendor/hookscript.js';
import { SCENES, runScene, sceneMs, wanted } from '../src/ui/rule-play-scenes.js';
import { IDEAS, ideaById } from '../src/data/ideas.js';

const ids = Object.keys(SCENES);

test('every scene belongs to a rule idea with a bundled example script', () => {
  assert.ok(ids.length >= 8, `only ${ids.length} scenes`);
  for (const id of ids) {
    assert.ok(ideaById[id], `${id} is not in src/data/ideas.js`);
    assert.ok(hs.EXAMPLES[id], `${id} has no example script in the bundle`);
  }
  // the home page's tabs
  for (const id of ['king-of-the-hill', 'tag', 'hot-potato', 'jackpot', 'fomo']) assert.ok(SCENES[id], id);
});

for (const id of ids) {
  test(`scene: ${id} plays out as its story says`, () => {
    const run = runScene(hs, id);
    assert.ok(run, `${id}: the script didn't compile`);
    const beats = run.frames.filter((f) => f.type !== 'start');
    assert.ok(beats.length >= 7 && beats.length <= 14, `${id}: ${beats.length} beats`);
    const ms = sceneMs(run);
    assert.ok(ms >= 15_000 && ms <= 25_000, `${id}: ${ms} ms`);
    for (const [i, f] of beats.entries()) {
      const at = `${id} beat ${i + 1} (${f.text}, ${f.clock})`;
      assert.notEqual(f.verdict, 'skip', `${at}: nothing to trade`);
      assert.equal(f.verdict, f.expect, `${at}: the VM said ${f.verdict}${f.message ? ` “${f.message}”` : ''}`);
      if (f.verdict === 'no') {
        assert.ok(f.message && !f.message.includes('{}'), `${at}: no readable refusal`);
        assert.doesNotMatch(f.message, /error/i, `${at}: the VM faulted`);
      }
      for (const [k, want] of Object.entries(f.want ?? {})) assert.equal(wanted(f.state, k), want, `${at}: ${k}`);
      for (const n of f.notes) assert.ok(n.text && !/undefined|null|NaN/.test(n.text), `${at}: note “${n.text}”`);
      for (const [k, v] of f.chips) assert.ok(k && v && !/undefined|null|NaN/.test(`${k} ${v}`), `${at}: chip ${k}: ${v}`);
      for (const b of f.badges) assert.ok(run.cast.includes(b.who), `${at}: badge on ${b.who}`);
    }
    // a scene about a rule that refuses things shows at least one refusal and one trade that goes through
    const refuses = run.frames.some((f) => f.verdict === 'no');
    assert.equal(refuses, (hs.compile(hs.EXAMPLES[id]).abi.reasons ?? []).length > 0, `${id}: refusals`);
    assert.ok(beats.some((f) => f.verdict === 'ok'), `${id}: nothing went through`);
    // payout lines come from the script's own payout, never with made-up SOL amounts
    const payouts = hs.compile(hs.EXAMPLES[id]).abi.payouts ?? [];
    if (payouts.length && run.payout) assert.doesNotMatch(run.payout, /\d+(\.\d+)?\s*SOL/i, id);
    if (payouts.length) assert.ok(run.payout, `${id}: the script pays out but the scene doesn't say so`);
  });
}

test('scene copy follows the site rules', () => {
  for (const id of ids) {
    const run = runScene(hs, id);
    const text = JSON.stringify(run.frames.map((f) => [f.text, f.message, f.notes, f.chips, f.clock])) + (run.payout ?? '');
    assert.doesNotMatch(text, /0x|\bdemo\b|preview|devnet|coming soon|\bmock/i, id);
  }
  assert.ok(IDEAS.filter((x) => SCENES[x.id]).length === ids.length);
});
