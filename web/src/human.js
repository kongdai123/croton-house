// Seated body you see when you look down: the Yireeb World Builder block-human proxy (1.70 m, spine .485, thigh .43,
// shin .42, hip width .28) posed sitting, with the same Mii-style face so he recognises the little guy.
import { THREE, M, box, sphere, cyl, group, declare } from './kit.js';

const BODY = { spine: 0.485, thigh: 0.43, shin: 0.42, hipWidth: 0.28, ankleHeight: 0.06, head: 0.305 };
export class Human {
  constructor(scene, player) {
    this.scene = scene; this.player = player;
    const shirt = new THREE.MeshStandardMaterial({ color: 0xcfe0f1, roughness: 0.85 }), pants = new THREE.MeshStandardMaterial({ color: 0x353c48, roughness: 0.85 }), skin = new THREE.MeshStandardMaterial({ color: 0xf5dcc6, roughness: 0.7 }), shoe = new THREE.MeshStandardMaterial({ color: 0x2a2220, roughness: 0.6 });
    const g = new THREE.Group(); this.root = g; g.visible = false; declare(g, { role: 'visitor' });
    // seated pose in local space: origin at the seat point (hip centre on the seat), facing +Z
    this.torso = box(0.34, BODY.spine, 0.2, shirt, { r: 0.03, y: BODY.spine / 2 + 0.02, z: -0.05 }); g.add(this.torso);
    this.head = sphere(BODY.head / 2, skin, { y: BODY.spine + 0.02 + BODY.head / 2 + 0.03, z: -0.03 }); g.add(this.head);
    for (const s of [-1, 1]) {
      g.add(box(0.14, 0.12, BODY.thigh, pants, { r: 0.03, x: s * BODY.hipWidth / 2 * 0.8, y: 0.06, z: BODY.thigh / 2 - 0.08 }));              // thighs forward
      g.add(box(0.12, BODY.shin, 0.12, pants, { r: 0.03, x: s * BODY.hipWidth / 2 * 0.8, y: -BODY.shin / 2 + 0.06, z: BODY.thigh - 0.08 }));   // shins down
      g.add(box(0.11, 0.07, 0.26, shoe, { r: 0.02, x: s * BODY.hipWidth / 2 * 0.8, y: -BODY.shin + 0.06 - 0.03, z: BODY.thigh - 0.08 + 0.06 }));
      g.add(box(0.09, 0.09, 0.32, shirt, { r: 0.03, x: s * 0.22, y: 0.12, z: 0.06 }));                                                        // forearms resting on the thighs
      g.add(sphere(0.045, skin, { x: s * 0.22, y: 0.12, z: 0.24 }));
    }
    scene.add(g);
  }
  sitAt(seatWorld, facing) { this.root.position.copy(seatWorld); this.root.rotation.y = facing; this.root.scale.setScalar(0.82); this.root.visible = true; }
  hide() { this.root.visible = false; }
  update(dt) {
    if (!this.root.visible) return;
    // the head follows where the camera looks (yaw only, a little), torso leans back slightly over time
    const p = this.player; const yawRel = Math.atan2(Math.sin(p.yaw + Math.PI - this.root.rotation.y), Math.cos(p.yaw + Math.PI - this.root.rotation.y));
    this.head.rotation.y = Math.max(-0.9, Math.min(0.9, yawRel));
    this.head.visible = false;  // the camera is inside the head; hide it so it never clips the view
  }
}
