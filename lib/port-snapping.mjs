/**
 * Pick the input/output port represented by a clicked grid cell.
 * A device cell may identify the entity directly; an otherwise empty cell may
 * still be the external transport cell immediately in front of a port.
 */
export function selectSnapPort(ports, options) {
  const {
    transport,
    type,
    x,
    y,
    entityId,
    cols,
    rows,
    occupiedKeys = new Set(),
    draftKeys = new Set(),
    replaceableKeys = new Set(),
    lastPoint,
    snapRadius = 1,
  } = options;

  return ports
    .filter((port) => {
      if (port.transport !== transport || port.type !== type) return false;
      const pointerDistance = Math.abs(port.externalX - x) + Math.abs(port.externalY - y);
      if (entityId ? port.entityId !== entityId : pointerDistance > snapRadius) return false;
      if (port.externalX < 0 || port.externalY < 0 || port.externalX >= cols || port.externalY >= rows) return false;
      const externalKey = `${port.externalX},${port.externalY}`;
      if (occupiedKeys.has(externalKey) && !replaceableKeys.has(externalKey)) return false;
      if (draftKeys.has(externalKey) && !(lastPoint?.x === port.externalX && lastPoint?.y === port.externalY)) return false;
      return true;
    })
    .sort((a, b) => {
      const aPointerDistance = Math.abs(a.externalX - x) + Math.abs(a.externalY - y);
      const bPointerDistance = Math.abs(b.externalX - x) + Math.abs(b.externalY - y);
      return aPointerDistance - bPointerDistance || Math.abs(a.cellX - x) + Math.abs(a.cellY - y) - Math.abs(b.cellX - x) - Math.abs(b.cellY - y) || a.index - b.index;
    })[0] ?? null;
}
