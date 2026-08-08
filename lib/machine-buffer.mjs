/** Count item-type slots that currently contain at least one unit. */
export function occupiedSharedSlots(bucket) {
  return Object.values(bucket).filter((quantity) => quantity > 0).length;
}

/** A shared slot stores one item type and at most slotCapacity units. */
export function sharedBufferCanAccept(bucket, itemId, slotCount, amount = 1, slotCapacity = 50) {
  const current = bucket[itemId] ?? 0;
  return current + amount <= slotCapacity && (current > 0 || occupiedSharedSlots(bucket) < slotCount);
}

/** Return the projected buffer after adding outputs, or null when any slot would overflow. */
export function sharedBufferWithOutputs(bucket, outputs, slotCount, slotCapacity = 50) {
  const next = { ...bucket };
  for (const output of outputs) {
    if (!sharedBufferCanAccept(next, output.itemId, slotCount, output.amount, slotCapacity)) return null;
    next[output.itemId] = (next[output.itemId] ?? 0) + output.amount;
  }
  return next;
}

/** Project one complete recipe against a shared input/output slot bank. */
export function sharedBufferAfterRecipe(bucket, recipe, slotCount, slotCapacity = 50) {
  const next = { ...bucket };
  for (const requirement of recipe.inputs) {
    if ((next[requirement.itemId] ?? 0) < requirement.amount) return null;
    next[requirement.itemId] = Math.max(0, (next[requirement.itemId] ?? 0) - requirement.amount);
  }
  return sharedBufferWithOutputs(next, recipe.outputs, slotCount, slotCapacity);
}

/**
 * Select exactly one recipe for a serial auto-scheduled machine.
 * An already-started recipe always keeps the machine lock; otherwise the
 * cursor determines the first runnable recipe in round-robin order.
 */
export function serialRecipeCandidate(recipes, cursor, isActive, isRunnable) {
  const active = recipes.find(isActive);
  if (active) return active;
  if (!recipes.length) return null;
  const start = ((cursor % recipes.length) + recipes.length) % recipes.length;
  for (let offset = 0; offset < recipes.length; offset += 1) {
    const candidate = recipes[(start + offset) % recipes.length];
    if (isRunnable(candidate)) return candidate;
  }
  return null;
}
