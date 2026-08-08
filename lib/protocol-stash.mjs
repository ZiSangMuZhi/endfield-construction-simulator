import { sharedBufferCanAccept } from "./machine-buffer.mjs";

export const PROTOCOL_STASH_SLOTS = 6;
export const PROTOCOL_STASH_SLOT_CAPACITY = 50;
export const PROTOCOL_STASH_TRANSFER_SECONDS = 5;

export function protocolStashCanAccept(bucket, itemId, amount = 1) {
  return sharedBufferCanAccept(bucket, itemId, PROTOCOL_STASH_SLOTS, amount, PROTOCOL_STASH_SLOT_CAPACITY);
}

export function advanceProtocolStash(bucket, elapsedTicks, { wireless, powered, transferTicks }) {
  if (!wireless || !powered) return { bucket, elapsedTicks: 0, transferred: {} };
  const nextElapsedTicks = elapsedTicks + 1;
  if (nextElapsedTicks < transferTicks) return { bucket, elapsedTicks: nextElapsedTicks, transferred: {} };
  return { bucket: {}, elapsedTicks: 0, transferred: { ...bucket } };
}
