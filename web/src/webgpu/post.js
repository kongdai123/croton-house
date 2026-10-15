import { AgXToneMapping, RenderPipeline } from 'three/webgpu';
import { pass, vec4 } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { blenderAgX } from './agx.js';

export async function createPost(renderer, scene, camera, query) {
  renderer.toneMapping = AgXToneMapping;
  renderer.toneMappingExposure = 2 ** -0.7;
  const scenePass = pass(scene, camera), color = scenePass.getTextureNode('output');
  let output = color, gtao = null;
  if (query.get('ao') === '1') {
    // r183 supports depth-derived normals, avoiding a second normal pass and
    // the old leaf-card overrideMaterial shader workaround.
    gtao = ao(scenePass.getTextureNode('depth'), null, camera);
    gtao.resolutionScale = 0.5; gtao.radius.value = 0.25; gtao.samples.value = 8;
    output = vec4(color.rgb.mul(gtao.getTextureNode().r), color.a);
  }
  const pipeline = new RenderPipeline(renderer);
  if (query.get('agx') === 'three') pipeline.outputNode = output;
  else {
    pipeline.outputNode = await blenderAgX(output, renderer.toneMappingExposure);
    // The LUT path already applies exposure, tone mapping and OCIO's exact sRGB
    // encoding. RenderPipeline disables the renderer transform while drawing.
    pipeline.outputColorTransform = false;
  }
  return { pipeline, scenePass, gtao };
}
