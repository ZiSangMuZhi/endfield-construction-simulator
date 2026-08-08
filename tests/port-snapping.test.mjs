import assert from "node:assert/strict";
import test from "node:test";
import { selectSnapPort } from "../lib/port-snapping.mjs";

const ports = [
  { key:"machine:output:0", entityId:"machine", type:"output", transport:"belt", index:0, cellX:2, cellY:2, externalX:1, externalY:2 },
  { key:"machine:input:0", entityId:"machine", type:"input", transport:"belt", index:0, cellX:4, cellY:2, externalX:5, externalY:2 },
  { key:"machine:input:1", entityId:"machine", type:"input", transport:"pipe", index:1, cellX:4, cellY:3, externalX:5, externalY:3 },
];

const base = { cols:18, rows:12, occupiedKeys:new Set(), draftKeys:new Set(), replaceableKeys:new Set() };

test("snaps an empty external transport cell to its equipment port", () => {
  assert.equal(selectSnapPort(ports,{...base,transport:"belt",type:"output",x:1,y:2})?.key,"machine:output:0");
  assert.equal(selectSnapPort(ports,{...base,transport:"belt",type:"input",x:5,y:2})?.key,"machine:input:0");
  assert.equal(selectSnapPort(ports,{...base,transport:"belt",type:"input",x:5,y:1})?.key,"machine:input:0");
  assert.equal(selectSnapPort(ports,{...base,transport:"belt",type:"input",x:6,y:1}),null);
});

test("keeps pipe and belt port snapping isolated", () => {
  assert.equal(selectSnapPort(ports,{...base,transport:"pipe",type:"input",x:5,y:2})?.key,"machine:input:1");
  assert.equal(selectSnapPort(ports,{...base,transport:"pipe",type:"input",x:5,y:3})?.key,"machine:input:1");
  assert.equal(selectSnapPort(ports,{...base,transport:"belt",type:"input",x:5,y:3})?.key,"machine:input:0");
});

test("does not steal an occupied external cell unless it belongs to a replanned tail", () => {
  const occupiedKeys=new Set(["5,2"]);
  assert.equal(selectSnapPort(ports,{...base,transport:"belt",type:"input",x:5,y:2,occupiedKeys}),null);
  assert.equal(selectSnapPort(ports,{...base,transport:"belt",type:"input",x:5,y:2,occupiedKeys,replaceableKeys:new Set(["5,2"])})?.key,"machine:input:0");
});
