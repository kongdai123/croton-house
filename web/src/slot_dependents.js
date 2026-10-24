// A time-of-day switch and what depends on it. The objects' onTime hooks (layout.js placements: the fire pit lights at
// dusk, the sheer curtains close) follow the baked slot. They start when the slot's crossfade begins (lightmap_slots.js
// reports the 'transition' phase once the destination is staged and its 1.5 s fade starts), so they animate with the
// light. They used to wait for the fade to end: the fire lit only after dusk had fully arrived, the curtains closed after
// it (docs/audit/postmortem.md, row 27). When the switch settles (done, failed, replaced by a later request, or the bake
// disposed under it) they are set once more to the slot actually shown, so no outcome leaves the fire lit by day.
// No three, DOM or GPU: tools/test_slot_dependents.mjs.
//
// setSlot(name, onProgress): the bake's slot switch (lightmap.js api.setSlot), resolving true once the fade has ended.
// apply(slotName): set the dependents to that slot (idempotent: an animated toggle asked for its current state does nothing).
// shown(): the slot on screen now, or null when there is none (the bake was disposed; its fallback re-applies the time).
export function slotSwitch({ setSlot, apply, shown }) {
  return async (name, onProgress) => {
    let begun = null;
    const progress = (fraction, info = {}) => {
      if (info?.phase === 'transition' && begun === null) { begun = info.name ?? name; apply(begun); }
      onProgress?.(fraction, info);
    };
    try { return await setSlot(name, progress); }
    finally { const now = shown(); if (now != null) apply(now); }
  };
}
