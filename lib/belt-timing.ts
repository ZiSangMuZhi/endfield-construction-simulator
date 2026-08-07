/** Deterministic transport timing shared by simulation and presentation. */
export const SIM_TICKS_PER_SECOND = 10;
export const BELT_ITEMS_PER_MINUTE = 30;
export const BELT_HEADWAY_TICKS = Math.round(60 / BELT_ITEMS_PER_MINUTE * SIM_TICKS_PER_SECOND);

// Public data confirms 0.5 items/s throughput but does not expose a separate
// spatial speed. The planner models one grid module as one item pitch, so a
// normal belt advances 0.5 grid/s and traverses one cell in exactly 2 seconds.
export const BELT_CELL_TRAVEL_TICKS = BELT_HEADWAY_TICKS;

export function beltTravelTicks(cellCount: number) {
  if (!Number.isInteger(cellCount) || cellCount < 1) throw new RangeError("A belt route must contain at least one grid cell");
  return cellCount * BELT_CELL_TRAVEL_TICKS;
}

export function beltTravelSeconds(cellCount: number) {
  return beltTravelTicks(cellCount) / SIM_TICKS_PER_SECOND;
}

export function nextLaneReadyTick(dispatchTick: number) {
  return dispatchTick + BELT_HEADWAY_TICKS;
}

export function transitProgress(startedAt: number, travelTicks: number, currentTick: number) {
  if (travelTicks <= 0) return 1;
  return Math.max(0, Math.min(1, (currentTick - startedAt) / travelTicks));
}
