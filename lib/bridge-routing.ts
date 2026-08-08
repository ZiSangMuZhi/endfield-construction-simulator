export type BridgeDirection = 0 | 1 | 2 | 3;
export type BridgePortLike = {
  entityId:string;
  entityKind:string;
  index:number;
  side:BridgeDirection;
};
export type BridgeRouteLike = {
  id:string;
  sourcePort?:BridgePortLike;
  targetPort?:BridgePortLike;
};

const opposite=(direction:BridgeDirection)=>((direction+2)%4) as BridgeDirection;
const isBridgeKind=(kind:string)=>kind==="logisticsBridge"||kind==="pipeBridge";

export function bridgePortsPair(inputPort:BridgePortLike,outputPort:BridgePortLike|undefined) {
  return Boolean(outputPort&&isBridgeKind(inputPort.entityKind)&&outputPort.entityId===inputPort.entityId&&outputPort.index===inputPort.index&&outputPort.side===opposite(inputPort.side));
}

export function pairedBridgeOutput<T extends BridgeRouteLike>(incoming:T,routes:T[]) {
  const inputPort=incoming.targetPort;
  if(!inputPort||!isBridgeKind(inputPort.entityKind))return undefined;
  return routes.find((candidate)=>bridgePortsPair(inputPort,candidate.sourcePort));
}
