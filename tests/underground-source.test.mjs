import assert from "node:assert/strict";
import test from "node:test";
import { advanceUndergroundSourceCredit, clampUndergroundSourceRate } from "../lib/underground-source.mjs";

const TICKS_PER_SECOND = 4;
const MAXIMUM_RATE = 120;

function emittedInOneMinute(ratePerMinute) {
  let credit = 0;
  let emitted = 0;
  for (let tick = 0; tick < 60 * TICKS_PER_SECOND; tick++) {
    credit = advanceUndergroundSourceCredit(credit, ratePerMinute, TICKS_PER_SECOND, MAXIMUM_RATE);
    if (credit >= 1 - 1e-9) {
      emitted++;
      credit = Math.max(0, credit - 1);
    }
  }
  return emitted;
}

test("clamps underground source rate to pipe capacity", () => {
  assert.equal(clampUndergroundSourceRate(-5, MAXIMUM_RATE), 0);
  assert.equal(clampUndergroundSourceRate(75, MAXIMUM_RATE), 75);
  assert.equal(clampUndergroundSourceRate(150, MAXIMUM_RATE), MAXIMUM_RATE);
  assert.equal(clampUndergroundSourceRate(Number.NaN, MAXIMUM_RATE), 0);
});

test("fractional credit preserves configured per-minute output", () => {
  assert.equal(emittedInOneMinute(30), 30);
  assert.equal(emittedInOneMinute(60), 60);
  assert.equal(emittedInOneMinute(100), 100);
  assert.equal(emittedInOneMinute(120), 120);
});

test("blocked sources retain at most one unit of credit without a later burst", () => {
  let credit = 0;
  for (let tick = 0; tick < 60 * TICKS_PER_SECOND; tick++) {
    credit = Math.min(1, advanceUndergroundSourceCredit(credit, 120, TICKS_PER_SECOND, MAXIMUM_RATE));
  }
  assert.equal(credit, 1);
  assert.equal(advanceUndergroundSourceCredit(credit, 0, TICKS_PER_SECOND, MAXIMUM_RATE), 0);
});
