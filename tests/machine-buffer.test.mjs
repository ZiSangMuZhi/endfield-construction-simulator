import assert from "node:assert/strict";
import test from "node:test";
import { occupiedSharedSlots, serialRecipeCandidate, sharedBufferAfterRecipe, sharedBufferCanAccept, sharedBufferWithOutputs } from "../lib/machine-buffer.mjs";

test("models four/eight shared item slots with a 50-unit limit", () => {
  const eightKinds = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`item-${index}`, 1]));
  assert.equal(occupiedSharedSlots(eightKinds), 8);
  assert.equal(sharedBufferCanAccept(eightKinds, "ninth-item", 8), false);
  assert.equal(sharedBufferCanAccept(eightKinds, "item-0", 8, 49), true);
  assert.equal(sharedBufferCanAccept(eightKinds, "item-0", 8, 50), false);
});

test("returns products to the same slots after consuming recipe inputs", () => {
  const recipe = { inputs: [{ itemId: "powder", amount: 1 }, { itemId: "water", amount: 1 }], outputs: [{ itemId: "solution", amount: 1 }] };
  assert.deepEqual(sharedBufferAfterRecipe({ powder: 1, water: 1 }, recipe, 4), { powder: 0, water: 0, solution: 1 });
  assert.equal(sharedBufferAfterRecipe({ powder: 1 }, recipe, 4), null);
});

test("holds a completed recipe when its product slot cannot accept output", () => {
  assert.equal(sharedBufferWithOutputs({ product: 50 }, [{ itemId: "product", amount: 1 }], 8), null);
  assert.equal(sharedBufferWithOutputs({ a: 1, b: 1, c: 1, d: 1 }, [{ itemId: "new", amount: 1 }], 4), null);
});

test("serial auto scheduling keeps one active recipe and advances in round-robin order", () => {
  const recipes = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const active = serialRecipeCandidate(recipes, 2, (recipe) => recipe.id === "b", () => true);
  assert.equal(active?.id, "b");

  const next = serialRecipeCandidate(recipes, 2, () => false, (recipe) => recipe.id !== "c");
  assert.equal(next?.id, "a");

  const none = serialRecipeCandidate(recipes, 1, () => false, () => false);
  assert.equal(none, null);
});
