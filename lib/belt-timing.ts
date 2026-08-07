/** Deterministic transport timing shared by simulation and presentation. */
export const SIM_TICK_MS = 250;
export const SIM_TICKS_PER_SECOND = 1000 / SIM_TICK_MS;
export const BELT_ITEMS_PER_MINUTE = 30;
export const BELT_HEADWAY_TICKS = Math.round(60 / BELT_ITEMS_PER_MINUTE * SIM_TICKS_PER_SECOND);
export const BELT_CELLS_PER_TICK = 1 / BELT_HEADWAY_TICKS;
export const PIPE_ITEMS_PER_MINUTE = 120;
export const PIPE_HEADWAY_TICKS = Math.round(60 / PIPE_ITEMS_PER_MINUTE * SIM_TICKS_PER_SECOND);
export const PIPE_CELLS_PER_TICK = 1 / PIPE_HEADWAY_TICKS;
export const PIPE_UNITS_PER_CELL = 4;

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

export function nextLaneReadyTick(dispatchTick: number, headwayTicks = BELT_HEADWAY_TICKS) {
  return dispatchTick + headwayTicks;
}

export function transitProgress(startedAt: number, travelTicks: number, currentTick: number) {
  if (travelTicks <= 0) return 1;
  return Math.max(0, Math.min(1, (currentTick - startedAt) / travelTicks));
}

export type BeltLaneItem = { position:number; previousPosition:number };

export type LaneProfile = { cellsPerTick:number; itemPitch:number; unitsPerCell:number };
export const BELT_LANE_PROFILE:LaneProfile = {cellsPerTick:BELT_CELLS_PER_TICK,itemPitch:1,unitsPerCell:1};
export const PIPE_LANE_PROFILE:LaneProfile = {cellsPerTick:PIPE_CELLS_PER_TICK,itemPitch:1/PIPE_UNITS_PER_CELL,unitsPerCell:PIPE_UNITS_PER_CELL};

export function advanceTransportLane<T extends BeltLaneItem>(items:T[],cellCount:number,canExit:boolean,profile:LaneProfile) {
  if (!Number.isInteger(cellCount) || cellCount < 1) throw new RangeError("A belt route must contain at least one grid cell");
  const ordered=[...items].sort((a,b)=>b.position-a.position);
  const active:T[]=[];
  const delivered:T[]=[];
  let leaderPosition=Number.POSITIVE_INFINITY;
  for(const item of ordered){
    const endLimit=active.length===0?(canExit?cellCount:cellCount-profile.itemPitch/2):leaderPosition-profile.itemPitch;
    const desired=Math.min(item.position+profile.cellsPerTick,endLimit);
    if(active.length===0&&canExit&&desired>=cellCount-1e-9){delivered.push(item);continue}
    const position=Math.max(item.position,desired);
    active.push({...item,previousPosition:item.position,position});
    leaderPosition=position;
  }
  return {active,delivered,moved:active.some((item)=>item.position>item.previousPosition+1e-9)};
}

export function transportLaneCanAccept(items:BeltLaneItem[],cellCount:number,profile:LaneProfile) {
  if(items.length>=cellCount*profile.unitsPerCell)return false;
  if(!items.length)return true;
  return Math.min(...items.map((item)=>item.position))>=profile.itemPitch-1e-9;
}

export function transportLaneIsFull(items:BeltLaneItem[],cellCount:number,profile:LaneProfile) {
  if(items.length<cellCount*profile.unitsPerCell)return false;
  const positions=items.map((item)=>item.position);
  return Math.max(...positions)>=cellCount-profile.itemPitch/2-1e-9&&Math.min(...positions)<=profile.itemPitch/2+1e-9;
}

export const advanceBeltLane=<T extends BeltLaneItem>(items:T[],cellCount:number,canExit:boolean)=>advanceTransportLane(items,cellCount,canExit,BELT_LANE_PROFILE);
export const beltLaneCanAccept=(items:BeltLaneItem[],cellCount:number)=>transportLaneCanAccept(items,cellCount,BELT_LANE_PROFILE);
export const beltLaneIsFull=(items:BeltLaneItem[],cellCount:number)=>transportLaneIsFull(items,cellCount,BELT_LANE_PROFILE);
export const advancePipeLane=<T extends BeltLaneItem>(items:T[],cellCount:number,canExit:boolean)=>advanceTransportLane(items,cellCount,canExit,PIPE_LANE_PROFILE);
export const pipeLaneCanAccept=(items:BeltLaneItem[],cellCount:number)=>transportLaneCanAccept(items,cellCount,PIPE_LANE_PROFILE);
export const pipeLaneIsFull=(items:BeltLaneItem[],cellCount:number)=>transportLaneIsFull(items,cellCount,PIPE_LANE_PROFILE);
