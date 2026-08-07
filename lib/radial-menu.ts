export type RadialAction = "rotate" | "move" | "copy" | "delete";

export const RADIAL_HOLD_DELAY_MS = 420;
export const RADIAL_CONFIRM_DELAY_MS = 210;
export const RADIAL_DEAD_ZONE_PX = 30;
export const RADIAL_PREOPEN_TOLERANCE_PX = 14;

export type RadialSelection = {
  action: RadialAction | null;
  angle: number;
  distance: number;
};

export function radialSelection(dx: number, dy: number, deadZone = RADIAL_DEAD_ZONE_PX): RadialSelection {
  const distance = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  if (distance < deadZone) return { action:null, angle, distance };
  if (angle >= -45 && angle < 45) return { action:"move", angle, distance };
  if (angle >= 45 && angle < 135) return { action:"copy", angle, distance };
  if (angle >= -135 && angle < -45) return { action:"rotate", angle, distance };
  return { action:"delete", angle, distance };
}
