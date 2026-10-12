// Daylight, blue hour, exposure adaptation and HQ post. Plan +y north = world -Z.
import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { M } from './materials.js';
import { collectLightSwitches } from './furniture/light_switch.js';
import { createHQ } from './hq.js';
import { bakeDaylight } from './daylight.js';

const DAY = 'drakensberg_solitary_mountain_puresky';
const DUSK = 'belfast_sunset_puresky';
const smooth = (a, b, v) => THREE.MathUtils.smoothstep(v, a, b);
const mix = THREE.MathUtils.lerp;
// Constant uniforms for the shared interior/exterior program (see collectMaterials).
const NO_DAY = { value: 0 }, UNIT = { value: 1 };
// Three still evaluates the BRDF/LTC for zero-intensity lights. Keep its static
// light arrays, but skip those calculations behind a uniform-only branch.
// The point and rect-area loops also stay real loops instead of three's unrolled copies: twelve unrolled LTC
// evaluations are what makes each program take ~9 s to compile through Direct3D's fxc on Windows (a rolled loop
// takes ~1.2 s, measured on an RTX 3070 laptop); Metal and Vulkan drivers never cared. The spot loop stays
// unrolled because spot light maps index a sampler array, which GLSL ES only allows with a constant.
// UNROLLED_LOOP_INDEX becomes 0 inside the rolled loops: this scene has no point-light shadows, which is the
// only place three uses it there (point shadows would need the unrolled form back).
const lightingChunk = THREE.ShaderChunk.lights_fragment_begin.replace(
  /(#pragma unroll_loop_start\n\t)(for \( int i = 0; i < NUM_(POINT|SPOT|RECT_AREA)_LIGHTS; i \+\+ \) \{)([\s\S]*?)(\n\t\}\n\t)(#pragma unroll_loop_end)/g,
  (_, start, loop, kind, body, close, end) => {
    const array = { POINT: 'pointLights', SPOT: 'spotLights', RECT_AREA: 'rectAreaLights' }[kind];
    const guarded = `${loop}\n\t\tif ( any( notEqual( ${array}[ i ].color, vec3( 0.0 ) ) ) ) {${body}\n\t\t}${close}`;
    if (kind === 'SPOT') return `${start}${guarded}${end}`;
    return guarded.replace(/UNROLLED_LOOP_INDEX/g, '0');
  });

// Unlike a studio HDR, this has no luminous softboxes reflected in leather or glass.
// Low frequency white-wall / oak-floor bounce; the actual openings supply direction.
function bounceEnvironment(pmrem, warm = false) {
  const room = new THREE.Scene();
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { warm: { value: warm ? 1 : 0 } },
    vertexShader: 'varying vec3 vDirection; void main() { vDirection = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float warm; varying vec3 vDirection;
      void main() {
        vec3 d = normalize(vDirection);
        vec3 walls = mix(vec3(0.68, 0.72, 0.76), vec3(1.8, 0.92, 0.36), warm);
        vec3 ceiling = mix(vec3(0.84, 0.88, 0.92), vec3(1.8, 0.96, 0.42), warm);
        vec3 floorBounce = mix(vec3(1.08, 1.10, 1.12), vec3(2.1, 1.05, 0.42), warm);
        vec3 c = mix(walls, ceiling, smoothstep(0.0, 0.85, d.y));
        c = mix(c, floorBounce, smoothstep(0.0, 0.85, -d.y));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const geometry = new THREE.SphereGeometry(10, 32, 16);
  room.add(new THREE.Mesh(geometry, material));
  const target = pmrem.fromScene(room, 0.08, 0.1, 30, { size: 512 });
  geometry.dispose(); material.dispose();
  return target;
}

export function createLighting(renderer, scene, camera, house, preset) {
  renderer.shadowMap.enabled = true;
  // r183 converts PCFSoft to PCF on first render; use that effective mode now
  // so shadow setup does not invalidate the programs compiled during loading.
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  RectAreaLightUniformsLib.init();
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  // Day and blue-hour room bounce are convolved only when that time of day is first needed.
  const rooms = new Map();
  const roomFor = isDusk => { if (!rooms.has(isDusk)) rooms.set(isDusk, bounceEnvironment(pmrem, isDusk)); return rooms.get(isDusk); };
  let blendTarget = null;
  const blendMaterial = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false,
    uniforms: { room: { value: null }, sky: { value: null }, skyMix: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform sampler2D room; uniform sampler2D sky; uniform float skyMix; varying vec2 vUv; void main() { gl_FragColor = mix(texture2D(room, vUv), texture2D(sky, vUv), skyMix); }',
  });
  const blendQuad = new FullScreenQuad(blendMaterial);
  let lastSkyMix = -1;
  const skies = new Map(), readySkies = new Map();
  let dusk = false, indoor = 0, exposure = 1, wasMoving = false, envRotation = 0;
  const interiorMaterials = new Set(), exteriorMaterials = new Set();
  const emissives = new Map();
  const glass = new Map();
  let daylight;
  let lightSwitches = [];
  const exteriorFinishes = new Set([M.stucco(), M.soffit(), M.roof()]);
  const exteriorBounce = { value: 2.8 };

  const sun = new THREE.DirectionalLight(0xfff7eb, 3.2);
  sun.name = 'Florida sun'; sun.castShadow = true;
  const shadowSize = p => Math.min(p.shadowMap, renderer.capabilities.maxTextureSize);
  sun.shadow.mapSize.set(shadowSize(preset), shadowSize(preset));
  sun.shadow.bias = -0.00006; sun.shadow.normalBias = 0.018;
  sun.shadow.radius = 2;
  sun.shadow.autoUpdate = false; sun.shadow.needsUpdate = true;
  Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 90 });
  sun.target.position.set(0, 0, -2.65);
  scene.add(sun, sun.target);
  // Modest white pavement bounce keeps shaded stucco white in HDR listing views.
  const hemi = new THREE.HemisphereLight(0xf0f4ff, 0xe6dfd2, 0.4);
  scene.add(hemi);
  const fixtures = new THREE.Group(); fixtures.name = 'Practical lights'; scene.add(fixtures);
  for (const [x, z] of [[-6, 1.5], [-6, 3.8]]) {
    const light = new THREE.PointLight(0xffe4be, 2.2, 7, 1.5);
    light.position.set(x, 2.35, z); light.userData.base = 2.2; light.userData.always = true; fixtures.add(light);
  }

  const windowLights = [];
  for (const o of house.openings) {
    const x = (o.x0 + o.x1) / 2, y = (o.y0 + o.y1) / 2;
    const north = o.dir === 'H' && y > 5.3;
    const south = o.dir === 'H' && y < -4.5;
    const east = o.dir === 'V' && x > 7.8;
    if (!(north || south || east) || (o.kind === 'door' && !north) || o.width < 0.55) continue;
    // Dining's adjacent pair shares one broad fill; bedroom B already has a slider.
    if (o.id === 'bf8cb9f37a' || o.id === '80a19a11da') continue;
    const sill = o.kind === 'window' ? house.windowSill : 0.12;
    const head = o.kind === 'window' ? house.windowHead : house.doorHeight;
    const light = new THREE.RectAreaLight(0xf1f5ff, north ? 2.8 : 3.4, o.width - 0.1, head - sill - 0.08);
    light.name = `Sky fill ${o.id}`;
    light.position.set(x, (head + sill) / 2, -y);
    const inward = new THREE.Vector3(east ? -1 : 0, 0, north ? 1 : -1);
    light.position.addScaledVector(inward, 0.13);
    light.lookAt(light.position.clone().add(inward));
    light.userData.dayIntensity = light.intensity;
    light.userData.north = north; light.userData.inward = inward;
    scene.add(light); windowLights.push(light);
  }

  const composer = new EffectComposer(renderer);
  // Reuse opaque colour-pass depth. GTAO reconstructs geometric normals from it,
  // avoiding a second draw of every leaf and preventing opaque-card AO artefacts.
  for (const target of [composer.renderTarget1, composer.renderTarget2]) {
    target.depthTexture = new THREE.DepthTexture(target.width, target.height, THREE.UnsignedIntType);
  }
  composer.addPass(new RenderPass(scene, camera));
  const gtao = new GTAOPass(scene, camera, innerWidth, innerHeight);
  gtao.output = GTAOPass.OUTPUT.Default;
  const renderAo = gtao.render.bind(gtao);
  gtao.render = (renderer, writeBuffer, readBuffer, ...args) => {
    gtao.setGBuffer(readBuffer.depthTexture);
    renderAo(renderer, writeBuffer, readBuffer, ...args);
  };
  gtao.updateGtaoMaterial({ radius: 0.22, distanceExponent: 1.4, thickness: 0.5, distanceFallOff: 1, scale: 1, samples: 12, screenSpaceRadius: false });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 3, radiusExponent: 1, rings: 2, samples: 16 });
  gtao.blendIntensity = 0.9;
  composer.addPass(gtao);
  const hqEffects = createHQ(renderer, composer, gtao, preset);
  const smaa = new SMAAPass(innerWidth * renderer.getPixelRatio(), innerHeight * renderer.getPixelRatio());
  // SMAA needs display-referred input; apply tone mapping / output conversion first.
  composer.addPass(new OutputPass()); composer.addPass(smaa);
  smaa.enabled = preset.smaa;

  async function loadSky(isDusk = false) {
    const name = isDusk ? DUSK : DAY;
    if (!skies.has(name)) {
      const pending = new RGBELoader().setDataType(THREE.HalfFloatType).loadAsync(`assets/hdr/${name}_2k.hdr`).then(hdr => {
        if (isDusk) {
          // Preserve the photographed cloud structure, shift sunset to blue hour.
          const data = hdr.image.data;
          for (let i = 0; i < data.length; i += 4) {
            for (let c = 0; c < 3; c++) data[i + c] = THREE.DataUtils.toHalfFloat(THREE.DataUtils.fromHalfFloat(data[i + c]) * [0.4, 0.7, 1.25][c]);
          }
          hdr.needsUpdate = true;
        }
        hdr.mapping = THREE.EquirectangularReflectionMapping;
        let brightest = -Infinity, pixel = 0;
        const data = hdr.image.data;
        for (let i = 0; i < data.length; i += 4) {
          const luminance = THREE.DataUtils.fromHalfFloat(data[i]) + THREE.DataUtils.fromHalfFloat(data[i + 1]) + THREE.DataUtils.fromHalfFloat(data[i + 2]);
          if (luminance > brightest) { brightest = luminance; pixel = i / 4; }
        }
        const longitude = ((pixel % hdr.image.width) / hdr.image.width - 0.5) * Math.PI * 2;
        const sky = { background: hdr, target: pmrem.fromEquirectangular(hdr), longitude };
        readySkies.set(name, sky);
        return sky;
      });
      skies.set(name, pending);
    }
    return skies.get(name);
  }

  function inside(x, y) {
    // Include the west garage annex, but respect the recessed front porch.
    const front = x < -3.5 || x > 3.97 ? -5.94 : -4.82;
    return x >= -8.1 && x <= 8.1 && y >= front && y <= 5.62;
  }
  function indoorWeight(position) {
    const x = position.x, y = -position.z;
    const front = x < -3.5 || x > 3.97 ? -5.74 : -4.66;
    const distance = Math.min(x + 7.9, 7.91 - x, y - front, 5.47 - y);
    return smooth(-0.45, 0.55, distance) * (1 - smooth(house.ceiling, house.ceiling + 0.6, position.y));
  }

  function collectMaterials(root) {
    // Layout's light budget can be exhausted before the porch sconce is reached.
    const sconce = new THREE.PointLight(0xffd29b, 0, 3.5, 2);
    sconce.position.set(0.8, 2.05, 5.0); sconce.name = 'Porch sconce source';
    sconce.userData.base = 3; sconce.userData.exterior = true; fixtures.add(sconce);
    lightSwitches = collectLightSwitches(root, fixtures);
    // A shared material may serve both a room and a garden bench. Split only those
    // uses, so looking through a window never gives the garden studio reflections.
    root.updateMatrixWorld(true);
    daylight = bakeDaylight(root, windowLights);
    const groups = new Map(), center = new THREE.Vector3(), box = new THREE.Box3();
    root.traverse(o => {
      if (!o.isMesh || o.isReflector) return;
      o.geometry.computeBoundingBox();
      box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld); box.getCenter(center);
      const region = inside(center.x, -center.z) && center.y < house.ceiling + 0.05 && box.max.x - box.min.x < 17 && box.max.z - box.min.z < 13 ? interiorMaterials : exteriorMaterials;
      const assign = material => {
        if (material) hqEffects.collect(material);
        if (!material?.isMeshStandardMaterial) return material;
        // The outer skin sits centimetres inside the opening tolerance. Moving street faces (garage door sections, built in
        // their open pose under the ceiling) opt in with userData.exteriorFinish.
        const materialRegion = exteriorFinishes.has(material) || material.userData.exteriorFinish ? exteriorMaterials : region;
        let uses = groups.get(material);
        if (!uses) { uses = new Map(); uses.compile = material.onBeforeCompile; uses.key = material.customProgramCacheKey(); groups.set(material, uses); }
        let local = uses.get(materialRegion);
        if (!local) {
          local = uses.size ? material.clone() : material;
          // clone() does not retain custom shader callbacks (turf, mulch, etc.).
          if (local !== material) { local.onBeforeCompile = material.onBeforeCompile; local.onBeforeRender = material.onBeforeRender; local.customProgramCacheKey = material.customProgramCacheKey; }
          const previousCompile = uses.compile;
          const previousKey = uses.key;
          const exterior = materialRegion === exteriorMaterials;
          // Both regions and every paint tint share one program: the daylight volume, the paint tint and the pavement
          // bounce are uniforms (exterior: day flag 0, bounce on; interior: the shared day flag, bounce 1). Baking them
          // into the source split the same material features into two or three programs each, and every program is
          // a ~90 KB shader that Windows compiles slowly.
          const paint = { value: local.userData.daylightPaint ?? 1 };
          local.onBeforeCompile = function (shader, renderer) {
            previousCompile.call(this, shader, renderer);
            if (!shader.uniforms.uHQShadow) hqEffects.patch(shader);
            shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', lightingChunk);
            daylight.patch(shader, paint, { day: exterior ? NO_DAY : daylight.day, bounce: exterior ? exteriorBounce : UNIT });
          };
          local.customProgramCacheKey = () => previousKey + '|hq-shadow|skip-dark-lights|daylight';
          uses.set(materialRegion, local); materialRegion.add(local);
          if (local.userData.daylightOpacity !== undefined && materialRegion === interiorMaterials) glass.set(local, local.opacity);
        }
        if (local.emissive && local.emissiveIntensity > 0 && !local.userData.lightGlow) emissives.set(local, local.emissiveIntensity);
        return local;
      };
      o.material = Array.isArray(o.material) ? o.material.map(assign) : assign(o.material);
    });
  }

  function setLightingEnvironment(texture, intensity, materials) {
    for (const material of materials) {
      // Both skies use the same CubeUV layout. Swapping them only changes a
      // sampler uniform; only the initial environment binding needs a program.
      const previous = material.envMap;
      material.envMap = texture;
      material.envMapIntensity = intensity;
      if (!previous || previous.mapping !== texture.mapping) material.needsUpdate = true;
    }
  }

  async function applyTime(isDusk) {
    dusk = isDusk;
    const sky = readySkies.get(dusk ? DUSK : DAY) ?? await loadSky(dusk);
    // A later toggle may have overtaken the asynchronous HDR load.
    if (isDusk !== dusk) return;
    if (daylight) daylight.day.value = dusk ? 0 : 1;
    for (const [material, opacity] of glass) material.opacity = dusk ? opacity : material.userData.daylightOpacity;
    scene.background = sky.background; scene.backgroundBlurriness = 0;
    scene.backgroundIntensity = dusk ? 0.6 : 0.9;
    scene.environment = sky.target.texture;
    scene.environmentIntensity = dusk ? 0.3 : 0.8;
    const room = roomFor(dusk);
    if (!blendTarget) { blendTarget = room.clone(); blendTarget.depthBuffer = false; }
    blendMaterial.uniforms.room.value = room.texture;
    blendMaterial.uniforms.sky.value = sky.target.texture; lastSkyMix = -1;
    setLightingEnvironment(blendTarget.texture, dusk ? 0.5 : 0.68, interiorMaterials);
    setLightingEnvironment(sky.target.texture, dusk ? 0.3 : 0.8, exteriorMaterials);
    sun.color.set(dusk ? 0xffbd8a : 0xfff7eb);
    sun.intensity = dusk ? 0.04 : 3.2;
    sun.position.set(dusk ? -30 : -11, dusk ? 5 : 30, -2.65 + (dusk ? 18 : 13));
    sun.shadow.needsUpdate = true;
    const sunLongitude = Math.atan2(sun.position.z - sun.target.position.z, sun.position.x - sun.target.position.x);
    const rotation = sky.longitude - sunLongitude; envRotation = rotation;
    scene.backgroundRotation.y = rotation; scene.environmentRotation.y = rotation;
    for (const material of exteriorMaterials) material.envMapRotation.y = rotation;
    hemi.color.set(dusk ? 0x8bade3 : 0xf0f4ff);
    hemi.groundColor.set(dusk ? 0x534332 : 0xe6dfd2);
    hemi.intensity = dusk ? 0.09 : 0.4;
    exteriorBounce.value = dusk ? 1 : 2.8;
    for (const light of windowLights) {
      const inward = light.userData.inward;
      // At blue hour the three glazed room openings spill warm light onto paving.
      light.lookAt(light.position.clone().addScaledVector(inward, dusk ? -1 : 1));
      light.color.set(dusk ? 0xffc884 : 0xf1f5ff);
      light.intensity = dusk ? (light.userData.north ? 3.2 : 0) : light.userData.dayIntensity;
    }
    for (const [material, base] of emissives) material.emissiveIntensity = dusk ? base * 1.8 : 0.12;
    for (const { toggle } of lightSwitches) toggle.onTime(dusk);
    indoor = indoorWeight(camera.position);
    update(0, true);
  }

  function update(dt, snap = false, moving = false) {
    for (const { toggle } of lightSwitches) toggle.tick(dt);
    const target = indoorWeight(camera.position);
    const alpha = snap ? 1 : 1 - Math.exp(-dt * 3);
    indoor = mix(indoor, target, alpha);
    // Moderate photographic adaptation: preserve the bright garden in window views.
    const targetExposure = dusk ? mix(1.1, 1.05, indoor) : mix(1.0, 1.12, indoor);
    exposure = mix(exposure, targetExposure, alpha);
    renderer.toneMappingExposure = exposure;
    // Keep the light-count shader defines stable outdoors and across time changes.
    // Zero intensity preserves the original contribution of hidden day fixtures.
    for (const light of fixtures.children) if (light.isLight) {
      const toggle = light.userData.lightSwitch;
      if (toggle?.manual) continue;
      const auto = light.userData.exterior ? (dusk ? 1 : 0) : dusk ? (light.userData.always ? 1 : 5) : (indoor > 0.01 ? 0.2 : 0);
      light.intensity = light.userData.base * auto * (toggle?.value ?? 1);
    }
    if (!dusk) for (const light of windowLights) {
      light.intensity = light.userData.dayIntensity * smooth(0.01, 0.7, indoor);
    }
    // Warm wall bounce increases smoothly as the eye moves away from an opening.
    const intensity = dusk ? mix(0.5, 0.55, indoor) : mix(0.62, 0.68, indoor);
    for (const material of interiorMaterials) material.envMapIntensity = intensity;
    const skyMix = (dusk ? 0.08 : 0.35) * (1 - indoor);
    if (blendTarget && (lastSkyMix < 0 || Math.abs(skyMix - lastSkyMix) > 0.002)) {
      blendMaterial.uniforms.skyMix.value = skyMix;
      const saved = renderer.getRenderTarget();
      renderer.setRenderTarget(blendTarget); blendQuad.render(renderer); renderer.setRenderTarget(saved);
      lastSkyMix = skyMix;
    }
    // Refresh during interactions and once when they stop, including the final
    // door/object pose. applyTime also invalidates the changed sun projection.
    if (moving || wasMoving) sun.shadow.needsUpdate = true;
    wasMoving = moving;
  }

  function setQuality(next) {
    hqEffects.setQuality(next); smaa.enabled = next.smaa;
    const size = shadowSize(next);
    if (sun.shadow.mapSize.x !== size) {
      sun.shadow.map?.dispose(); sun.shadow.map = null;
      sun.shadow.mapSize.set(size, size); sun.shadow.needsUpdate = true;
    }
  }
  // Download and convolve a sky (plus its room bounce) without showing it: the other time of day, after loading.
  async function prepareTime(isDusk) { await loadSky(isDusk); roomFor(isDusk); }
  // Pets are created after collectMaterials, so they miss the room/sky split. Each one
  // carries its own indoor flag: room bounce and the daylight volume inside, the sky outside.
  function attachPet(material) {
    if (!material?.isMeshStandardMaterial || material.userData.petPlace) return material;
    const place = { in: { value: 0 }, out: { value: 1 } };
    material.userData.petPlace = place;
    const prev = material.onBeforeCompile, prevKey = material.customProgramCacheKey?.bind(material);
    material.onBeforeCompile = function (shader, renderer) {
      prev?.call(this, shader, renderer);
      shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', lightingChunk);
      daylight?.patch(shader, 1);
      shader.uniforms.uInteriorDay = place.in;
      shader.uniforms.uPetOut = place.out;
      if (!shader.fragmentShader.includes('uniform float uPetOut')) shader.fragmentShader = 'uniform float uPetOut;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= mix(0.18, 1.0, uPetOut);');
    };
    material.customProgramCacheKey = () => (prevKey ? prevKey() : '') + '|pet-light';
    return material;
  }
  function syncPet(material, indoorPet) {
    const place = material?.userData.petPlace; if (!place) return;
    place.in.value = indoorPet && !dusk ? 1 : 0;
    place.out.value = indoorPet ? 0 : 1;
    const sky = readySkies.get(dusk ? DUSK : DAY);
    const map = indoorPet ? roomFor(dusk).texture : sky?.target.texture;
    if (!map) return;
    const intensity = indoorPet ? (dusk ? 0.55 : 0.66) : (dusk ? 0.3 : 0.75);
    if (material.envMap !== map) material.envMap = map;
    material.envMapIntensity = intensity;
    material.envMapRotation.y = indoorPet ? 0 : envRotation;
  }
  return { fixtures, composer, gtao, hqEffects, loadSky, prepareTime, collectMaterials, applyTime, update, setQuality, attachPet, syncPet, sun, windowLights, get daylight() { return daylight; }, get lightSwitches() { return lightSwitches; } };
}
