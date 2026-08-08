export const DEVICE_DRAG_THRESHOLD_PX = 7;

export type DragRect = { left:number; top:number; right:number; bottom:number; width:number; height:number };

export function deviceDragTarget(
  clientX:number,
  clientY:number,
  rect:DragRect,
  cols:number,
  rows:number,
  footprintWidth:number,
  footprintHeight:number,
  grabDx:number,
  grabDy:number,
) {
  if(clientX<rect.left||clientY<rect.top||clientX>rect.right||clientY>rect.bottom||rect.width<=0||rect.height<=0)return null;
  const pointerX=Math.min(cols-1,Math.max(0,Math.floor((clientX-rect.left)/rect.width*cols)));
  const pointerY=Math.min(rows-1,Math.max(0,Math.floor((clientY-rect.top)/rect.height*rows)));
  return {
    x:Math.min(Math.max(0,cols-footprintWidth),Math.max(0,pointerX-grabDx)),
    y:Math.min(Math.max(0,rows-footprintHeight),Math.max(0,pointerY-grabDy)),
  };
}
