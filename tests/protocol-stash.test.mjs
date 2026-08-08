import assert from "node:assert/strict";
import test from "node:test";
import { PROTOCOL_STASH_SLOT_CAPACITY, PROTOCOL_STASH_SLOTS, advanceProtocolStash, protocolStashCanAccept } from "../lib/protocol-stash.mjs";

test("models six protocol stash slots with 50 units per item type", () => {
  const sixKinds = Object.fromEntries(Array.from({ length: PROTOCOL_STASH_SLOTS }, (_, index) => [`item-${index}`, 1]));
  assert.equal(protocolStashCanAccept(sixKinds, "seventh-item"), false);
  assert.equal(protocolStashCanAccept(sixKinds, "item-0", PROTOCOL_STASH_SLOT_CAPACITY - 1), true);
  assert.equal(protocolStashCanAccept(sixKinds, "item-0", PROTOCOL_STASH_SLOT_CAPACITY), false);
});

test("wireless mode transfers the complete inventory on the fifth second", () => {
  let bucket = { ore: 12, parts: 3 };
  let elapsedTicks = 0;
  for (let tick = 0; tick < 19; tick++) {
    ({ bucket, elapsedTicks } = advanceProtocolStash(bucket, elapsedTicks, { wireless: true, powered: true, transferTicks: 20 }));
  }
  assert.deepEqual(bucket, { ore: 12, parts: 3 });
  const completed = advanceProtocolStash(bucket, elapsedTicks, { wireless: true, powered: true, transferTicks: 20 });
  assert.deepEqual(completed.bucket, {});
  assert.deepEqual(completed.transferred, { ore: 12, parts: 3 });
  assert.equal(completed.elapsedTicks, 0);
});

test("storage mode and missing power keep inventory in place", () => {
  const bucket = { ore: 12 };
  assert.deepEqual(advanceProtocolStash(bucket, 7, { wireless: false, powered: true, transferTicks: 20 }), { bucket, elapsedTicks: 0, transferred: {} });
  assert.deepEqual(advanceProtocolStash(bucket, 7, { wireless: true, powered: false, transferTicks: 20 }), { bucket, elapsedTicks: 0, transferred: {} });
});
