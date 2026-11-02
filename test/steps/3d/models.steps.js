import assert from 'node:assert/strict';
import { Then, When } from '@cucumber/cucumber';

Then('configured models preserve external assets and can be detached and reattached', async function () {
  const png = await this.page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 2;
    const context = canvas.getContext('2d');
    context.fillStyle = '#808080'; context.fillRect(0, 0, 2, 2);
    return canvas.toDataURL().split(',')[1];
  });
  const vertices = new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]);
  const description = {
    asset: { version: '2.0' },
    buffers: [{ uri: 'vertices.bin', byteLength: 60 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 24 }],
    accessors: [{ bufferView: 0, componentType: 5126, type: 'VEC3', count: 3 },
      { bufferView: 1, componentType: 5126, type: 'VEC2', count: 3 }],
    images: [{ uri: 'texture.png' }], textures: [{ source: 0 }],
    materials: [{
      pbrMetallicRoughness: { baseColorFactor: [0.6, 0.3, 0.1, 1], metallicFactor: 0.5,
        roughnessFactor: 0.4, baseColorTexture: { index: 0 }, metallicRoughnessTexture: { index: 0 } },
      emissiveTexture: { index: 0 }, emissiveFactor: [0.1, 0.2, 0.3],
      occlusionTexture: { index: 0, strength: 0.6 },
    }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }],
    nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }],
  };
  await this.page.route('**/manual/model.gltf', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(description),
  }));
  await this.page.route('**/manual/vertices.bin', route => route.fulfill({
    body: Buffer.concat([Buffer.from(vertices.buffer), Buffer.from(new Float32Array([0, 0, 1, 0, 0.5, 1]).buffer)]),
    contentType: 'application/octet-stream',
  }));
  await this.page.route('**/manual/texture.png', route => route.fulfill({
    contentType: 'image/png', body: Buffer.from(png, 'base64'),
  }));
  const result = await this.page.evaluate(async () => {
    const url = new URL('manual/model.gltf', document.baseURI).href;
    const layer = new L.Layer({ source: { type: '3d', url: url } });
    let ready = false;
    const loaded = nativeChecks.ready(layer).then(() => { ready = true; });
    await new Promise(requestAnimationFrame);
    const waitsForMap = !ready && !layer.model && !layer.renderer;
    layer.addTo(test3d.map);
    await loaded;
    const model = layer.model;
    let mesh;
    layer.traverse(model, node => { if (node.geometry) mesh = node; });
    const style = mesh.program._layerMaterial, gl = layer.renderer.gl;
    const attached = model.parent === layer.root && !('ready' in layer);
    const maps = style.baseTexture.internalFormat === gl.SRGB8_ALPHA8 &&
      style.metalTexture.internalFormat === gl.RGBA &&
      style.baseTexture === style.emissiveTexture && style.metalTexture === style.occlusionTexture &&
      style.baseTexture !== style.metalTexture;
    const factors = style.color.join() === '0.6,0.3,0.1' && style.metallic === 0.5 &&
      style.roughness === 0.4 && style.occlusionStrength === 0.6;
    const normals = [...mesh.geometry.attributes.normal.data].join() === '0,0,1,0,0,1,0,0,1';
    layer.add(model);
    layer._shared._render();
    const uploaded = style.baseTexture.uploaded === style.baseTexture.image &&
      style.metalTexture.uploaded === style.metalTexture.image;
    const program = mesh.program;
    layer.remove(model);
    const retained = !model.parent && mesh.program === program && gl.isProgram(program.program);
    layer.add(model);
    const reattached = model.parent === layer.root;
    layer.remove();
    return { waitsForMap, attached, maps, factors, normals, uploaded, retained, reattached };
  });
  for (const [name, value] of Object.entries(result)) {
    assert.equal(value, true, name);
  }
  delete description.meshes[0].primitives[0].attributes.TEXCOORD_0;
  await this.page.route('**/manual/no-uv.gltf', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(description),
  }));
  const missingUV = await this.page.evaluate(async () => {
    const layer = new L.Layer({ source: { type: '3d', url: 'manual/no-uv.gltf' } }).addTo(test3d.map);
    let programs = 0;
    const createProgram = layer._createProgram;
    layer._createProgram = function (...args) { programs++; return createProgram.apply(this, args); };
    const error = await nativeChecks.ready(layer).then(() => null, error => error);
    const result = error?.message === 'Textured model mesh requires UV coordinates' &&
      programs === 0 && !layer.model && layer.root.children.length === 0;
    layer.remove();
    return result;
  });
  assert.equal(missingUV, true, 'Missing UVs are rejected before allocating mesh resources');
});

Then('native triangulation and glTF decoding preserve geometry without library requests', async function () {
  await this.page.route('**/accessors.gltf?*', route => route.fulfill({
    contentType: 'application/json', body: new URL(route.request().url()).searchParams.get('fixture'),
  }));
  const result = await this.page.evaluate(async () => {
    const layer = new L.Layer({ source: { type: '3d' } }).addTo(test3d.map);
    await nativeChecks.ready(layer);
    const square = (x, y, size) => [{ x, y }, { x: x + size, y },
      { x: x + size, y: y + size }, { x, y: y + size }];
    const shapes = [
      [square(0, 0, 10), [square(1, 1, 2), square(6, 6, 2)], 92],
      [[{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 2 }, { x: 2, y: 2 },
        { x: 2, y: 6 }, { x: 0, y: 6 }], [], 20],
      [[{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 0 }, { x: 6, y: 0 },
        { x: 6, y: 6 }, { x: 0, y: 6 }], [], 36],
    ];
    let triangulated = true;
    for (const [contour, holes, expected] of shapes) {
      for (const reverse of [false, true]) {
        const outer = reverse ? [...contour].reverse() : contour;
        const inner = reverse ? holes.map(hole => [...hole].reverse()) : holes;
        const points = [outer, ...inner].flat();
        const triangles = layer.triangulate(outer, inner);
        const area = triangles.reduce((sum, [a, b, c]) => {
          const [p, q, r] = [points[a], points[b], points[c]];
          return sum + Math.abs((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)) / 2;
        }, 0);
        if (Math.abs(area - expected) > 1e-8) triangulated = false;
      }
    }
    let invalidRejected = false;
    try { layer.triangulate([{ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 2, y: 0 }]); }
    catch (error) { invalidRejected = error instanceof Error; }
    // Interleaved positions, normalized byte normals, and a sparse position override.
    const buffer = new ArrayBuffer(72);
    new Float32Array(buffer, 0, 12).set([0, 0, 0, 99, 1, 0, 0, 99, 0, 1, 0, 99]);
    new Uint8Array(buffer, 48, 9).set([0, 0, 255, 0, 0, 255, 0, 0, 255]);
    new Uint8Array(buffer, 57, 1)[0] = 1;
    new Float32Array(buffer, 60, 3).set([2, 0, 0]);
    const description = {
      buffers: [{ binary: buffer }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 48, byteStride: 16 },
        { buffer: 0, byteOffset: 48, byteLength: 9 }, { buffer: 0, byteOffset: 57, byteLength: 1 },
        { buffer: 0, byteOffset: 60, byteLength: 12 }],
      accessors: [{ bufferView: 0, componentType: 5126, type: 'VEC3', count: 3,
        sparse: { count: 1, indices: { bufferView: 2, componentType: 5121 }, values: { bufferView: 3 } } },
      { bufferView: 1, componentType: 5121, type: 'VEC3', count: 3, normalized: true }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 } }] }],
      materials: [], nodes: [{ mesh: 0, translation: [1, 2, 3] }, { mesh: 0, translation: [4, 5, 6] }],
      scenes: [{ nodes: [0, 1] }], scene: 0,
    };
    description.asset = { version: '2.0' };
    description.buffers = [{
      byteLength: buffer.byteLength,
      uri: `data:application/octet-stream;base64,${btoa(String.fromCharCode(...new Uint8Array(buffer)))}`,
    }];
    const url = new URL('accessors.gltf', document.baseURI);
    url.searchParams.set('fixture', JSON.stringify(description));
    const configured = new L.Layer({ source: { type: '3d', url: url.href } }).addTo(test3d.map);
    await nativeChecks.ready(configured);
    const model = configured.model;
    const [first, second] = model.children.map(node => node.children[0]);
    const decoded = [...first.geometry.attributes.position.data].join() === '0,0,0,2,0,0,0,1,0' &&
      [...first.geometry.attributes.normal.data].join() === '0,0,1,0,0,1,0,0,1' &&
      first !== second && first.geometry !== second.geometry;
    layer._updateWorldMatrix(first.parent);
    layer._updateWorldMatrix(second.parent);
    const transformed = (() => {
      const point = new DOMPoint(2, 0, 0, 1).matrixTransform(new DOMMatrix(first.worldMatrix));
      return [point.x / point.w, point.y / point.w, point.z / point.w].join() === '3,2,3';
    })();
    for (const mesh of [first, second]) {
      for (const attribute of Object.values(mesh.geometry.attributes)) mesh.geometry.gl.deleteBuffer(attribute.buffer);
      layer._removeProgram(mesh.program);
    }
    configured.remove();
    layer.remove();
    return { triangulated, invalidRejected, decoded, transformed };
  });
  for (const [name, value] of Object.entries(result)) assert.equal(value, true, name);
  assert.deepEqual(this.oglRequests, []);
  assert.deepEqual(this.threeRequests, []);
});

Then('a configured 3D model loads with its transforms and attribution', { timeout: 60000 }, async function () {
  const result = await this.page.evaluate(async () => {
    const map = test3d.map;
    const layer = new L.Layer({ source: { type: '3d',
      center: [48.8582601, 2.29449985],
      url: '../misc/eiffel-tower.glb',
      rotation: [0, 0.8, 0],
      scale: [1.02, 1, 1.01],
      tooltipContent: feature => feature.model === layer.model ? 'Eiffel Tower' : 'Unexpected model' },
      attribution: 'Test model attribution' }).addTo(map);
    await nativeChecks.ready(layer);
    const geometry = nativeChecks.bounds(layer.model, layer);
    const centered = layer.location.equals([48.8582601, 2.29449985]);
    const attached = layer.model.parent === layer.root;
    const rotation = layer.model.rotation[1];
    const scale = [...layer.model.scale];
    const attribution = map.attributionControl.getContainer().textContent.includes('Test model attribution');
    layer._shared._render();
    let texturedMeshes = 0, transparentMeshes = 0;
    layer.traverse(layer.model, mesh => {
      if (!mesh.program) return;
      const style = mesh.program._layerMaterial;
      if (style.baseTexture) {
        if (!mesh.geometry.attributes.uv || !style.baseTexture.image.width) {
          throw new Error('Model texture or UVs are missing');
        }
        texturedMeshes++;
      }
      if (style.alphaMode === 'BLEND' && mesh.program.transparent && !mesh.program.depthWrite) transparentMeshes++;
    });
    const gl = layer.renderer.gl;
    const drawGeometry = layer._drawGeometry;
    const pixels = () => {
      layer._shared._render();
      const data = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, data);
      return data;
    };
    const texturedPixels = pixels();
    const textures = new Map();
    layer.traverse(layer.model, mesh => {
      const texture = mesh.program?.uniforms.baseTexture?.value;
      if (!texture || textures.has(texture)) return;
      textures.set(texture, texture.image);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      canvas.getContext('2d').fillStyle = 'white';
      canvas.getContext('2d').fillRect(0, 0, 1, 1);
      texture.image = canvas;
      texture.needsUpdate = true;
    });
    const plainPixels = pixels();
    for (const [texture, image] of textures) { texture.image = image; texture.needsUpdate = true; }
    layer._shared._render();
    let changedPixels = 0;
    for (let i = 0; i < texturedPixels.length; i += 4) {
      if (Math.abs(texturedPixels[i] - plainPixels[i]) +
          Math.abs(texturedPixels[i + 1] - plainPixels[i + 1]) +
          Math.abs(texturedPixels[i + 2] - plainPixels[i + 2]) > 10) changedPixels++;
    }
    const realisticMaterials = texturedMeshes > 0 && transparentMeshes > 0 && changedPixels > 100;
    const programs = new Map();
    const passes = new Map();
    let linearTextures = true;
    layer.traverse(layer.model, mesh => {
      if (!mesh.program) return;
      programs.set(mesh, mesh.program);
      const style = { ...mesh.program._layerMaterial, alphaMode: 'BLEND' };
      mesh.program = layer._createProgram(style);
      if (style.baseTexture && gl.SRGB8_ALPHA8 && style.baseTexture.internalFormat !== gl.SRGB8_ALPHA8) {
        linearTextures = false;
      }
    });
    layer._drawGeometry = function (geometry, program, mode) {
      if (program.transparent) {
        if (!passes.has(geometry)) passes.set(geometry, []);
        passes.get(geometry).push(program.cullFace);
      }
      return drawGeometry.call(this, geometry, program, mode);
    };
    layer._shared._render();
    const list = [];
    const useProgram = layer._useProgram;
    layer._useProgram = function (program) {
      const mesh = [...programs.keys()].find(mesh => mesh.program === program);
      if (mesh && !list.includes(mesh)) list.push(mesh);
      return useProgram.call(this, program);
    };
    passes.clear();
    layer._shared._render();
    layer._useProgram = useProgram;
    const depths = list.map(mesh => {
      const world = new DOMPoint(...mesh.geometry.bounds.center, 1).matrixTransform(new DOMMatrix(mesh.worldMatrix));
      const point = world.matrixTransform(new DOMMatrix(layer.camera.projectionViewMatrix));
      return point.z / point.w;
    });
    const transparentOrder = depths.length > 1 && depths.every((depth, i) =>
      !i || depths[i - 1] >= depth) && Math.max(...depths) > Math.min(...depths);
    const doubleSidedPasses = passes.size > 0 && [...passes].every(([geometry, faces]) => {
      const mesh = [...programs.keys()].find(mesh => mesh.geometry === geometry);
      return faces.length === 2 && faces[0] === gl.FRONT && faces[1] === gl.BACK &&
        !mesh.program.depthWrite && mesh.program.cullFace === null;
    });
    layer._drawGeometry = drawGeometry;
    for (const [mesh, program] of programs) {
      layer._removeProgram(mesh.program);
      mesh.program = program;
    }
    layer._shared._render();
    const probe = nativeChecks.mesh(layer, {
      position: [-1, -1, 0.5, 1, -1, 0.5, 0, 1, 0.5, -1, -1, 0, 1, -1, 0, 0, 1, 0],
      normal: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
      color: [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    }, layer._createProgram({ vertexColors: true, alphaMode: 'MASK' }));
    const probeCamera = structuredClone(layer.camera);
    probeCamera.position.splice(0, 3, 0, 0, 3);
    probeCamera.target.splice(0, 3, 0, 0, 0);
    const sample = () => {
      layer._updateWorldMatrix(probe);
      layer._updateCamera(probeCamera);
      const modelView = new DOMMatrix(probeCamera.viewMatrix).multiply(new DOMMatrix(probe.worldMatrix)).toFloat64Array();
      const inverse = new DOMMatrix(modelView).inverse().toFloat64Array();
      Object.assign(probe.program.uniforms, {
        modelViewMatrix: { value: modelView }, projectionMatrix: { value: probeCamera.projectionMatrix },
        normalMatrix: { value: [inverse[0], inverse[4], inverse[8], inverse[1], inverse[5], inverse[9],
          inverse[2], inverse[6], inverse[10]] },
      });
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.depthMask(true); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      layer._useProgram(probe.program);
      layer._drawGeometry(probe.geometry, probe.program, gl.TRIANGLES);
      const pixel = new Uint8Array(4);
      gl.readPixels(Math.floor(gl.drawingBufferWidth / 2), Math.floor(gl.drawingBufferHeight / 2),
        1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return [...pixel];
    };
    const firstPixel = sample();
    for (const attribute of Object.values(probe.geometry.attributes)) {
      const first = attribute.data.slice(0, 9);
      attribute.data.copyWithin(0, 9);
      attribute.data.set(first, 9);
      attribute.needsUpdate = true;
    }
    const secondPixel = sample();
    const depthOrderIndependent = firstPixel.every((value, index) => value === secondPixel[index]) &&
      firstPixel[0] > firstPixel[2] && firstPixel[3] === 255;
    for (const attribute of Object.values(probe.geometry.attributes)) probe.geometry.gl.deleteBuffer(attribute.buffer);
    layer._removeProgram(probe.program);
    const container = map.getContainer();
    const rect = container.getBoundingClientRect();
    let position;
    layer.traverse(layer.model, object => {
      if (position || !object.geometry) return;
      const vertices = object.geometry.attributes.position;
      for (let i = 0; i < Math.min(vertices.count, 90); i++) {
        const offset = i * vertices.size;
        const world = new DOMPoint(vertices.data[offset], vertices.data[offset + 1], vertices.data[offset + 2], 1)
          .matrixTransform(new DOMMatrix(object.worldMatrix));
        const point = world.matrixTransform(new DOMMatrix(layer.camera.projectionViewMatrix));
        const x = point.x / point.w, y = point.y / point.w;
        if (Math.abs(x) >= 1 || Math.abs(y) >= 1) continue;
        const candidate = { clientX: Math.floor(rect.left + (x + 1) * rect.width / 2),
          clientY: Math.floor(rect.top + (1 - y) * rect.height / 2) };
        if (layer._findFeature(candidate)?.model === layer.model) {
          position = candidate;
          break;
        }
      }
    });
    if (!position) throw new Error('No visible model mesh was picked');
    const hit = layer._findFeature(position);
    const material = hit.mesh.program;
    container.dispatchEvent(new MouseEvent('mousemove', position));
    const tooltip = layer._tooltip;
    const modelTooltip = !tooltip.hidden && tooltip.textContent === 'Eiffel Tower' &&
      container.style.cursor === 'pointer' && layer.hoveredFeature.mesh === hit.mesh &&
      hit.mesh.program === material && !layer.highlightedFeature;
    container.dispatchEvent(new MouseEvent('click', position));
    for (const type of ['mouseout', 'mouseleave']) {
      container.dispatchEvent(new MouseEvent(type, { relatedTarget: document.body }));
    }
    const hoverOnly = tooltip.hidden && container.style.cursor !== 'pointer' && !layer.hoveredFeature;
    container.dispatchEvent(new MouseEvent('mousemove', position));
    layer.remove();
    const tooltipRemoved = !tooltip.isConnected && container.style.cursor !== 'pointer';
    const attributionRemoved = !map.attributionControl.getContainer().textContent.includes('Test model attribution');
    layer.addTo(map);
    const retained = layer.model.parent === layer.root;
    const tooltipRecreated = layer._tooltip !== tooltip && layer._tooltip.hidden;
    layer._shared._render();
    const restoredHit = layer._findFeature(position);
    const restoredGPU = restoredHit?.model === layer.model &&
      restoredHit.mesh.geometry.gl === layer.renderer.gl &&
      restoredHit.mesh.program.gl === layer.renderer.gl;
    let restoredTextures = true;
    layer.traverse(layer.model, mesh => {
      const texture = mesh.program?.uniforms.baseTexture?.value;
      if (texture && texture.gl !== layer.renderer.gl) restoredTextures = false;
    });
    layer.remove();
    return { centered, attached, rotation, scale, attribution, attributionRemoved, retained,
      modelTooltip, hoverOnly, tooltipRemoved, tooltipRecreated, restoredGPU, restoredTextures, realisticMaterials,
      depthOrderIndependent, linearTextures, transparentOrder, doubleSidedPasses,
      height: geometry.max[1] - geometry.min[1] };
  });
  assert.ok(result.height > 299 && result.height < 301);
  assert.equal(result.rotation, 0.8);
  assert.deepEqual(result.scale, [1.02, 1, 1.01]);
  for (const name of ['centered', 'attached', 'attribution', 'attributionRemoved', 'retained',
    'modelTooltip', 'hoverOnly', 'tooltipRemoved', 'tooltipRecreated', 'restoredGPU',
    'restoredTextures', 'realisticMaterials', 'depthOrderIndependent', 'linearTextures',
    'transparentOrder', 'doubleSidedPasses']) {
    assert.equal(result[name], true, name);
  }
  assert.deepEqual(this.threeRequests, []);
  assert.deepEqual(this.oglRequests, []);
});

When('I load a configured 3D model with {string}', async function (failure) {
  let body, status = 200;
  if (failure === 'HTTP error') { status = 404; body = 'Not found'; }
  else if (failure === 'unsupported glTF') {
    body = JSON.stringify({ asset: { version: '2.0' }, animations: [{}] });
  } else {
    body = Buffer.alloc(24);
    body.writeUInt32LE(0x46546c67, 0);
    body.writeUInt32LE(2, 4);
    body.writeUInt32LE(24, 8);
    body.writeUInt32LE(32, 12);
    body.writeUInt32LE(0x4e4f534a, 16);
  }
  await this.page.route('**/test/invalid-model.glb', route => route.fulfill({
    status, body, contentType: 'application/octet-stream',
  }));
  this.invalid3d = await this.page.evaluate(async () => {
    const layer = new L.Layer({ source: { type: '3d', url: 'invalid-model.glb' } }).addTo(test3d.map);
    let emitted;
    layer.on('error', event => { emitted = event.error; });
    const error = await nativeChecks.ready(layer).then(() => null, error => error);
    const result = { rejected: error instanceof Error, sameError: error === emitted,
      message: error?.message, noGeometry: !layer.model && layer.root.children.length === 0 };
    layer.remove();
    return { ...result, removed: !test3d.map.hasLayer(layer),
      noCanvas: !document.querySelector('.leaflet-3d') };
  });
});

Then('3D initialization emits {string} as an error', function (message) {
  assert.equal(this.invalid3d.rejected, true);
  assert.equal(this.invalid3d.sameError, true);
  assert.equal(this.invalid3d.message, message);
  assert.equal(this.invalid3d.removed, true);
  assert.equal(this.invalid3d.noCanvas, true);
});

Then('the failed model has no attached geometry', function () {
  assert.equal(this.invalid3d.noGeometry, true);
});

When('I hover and click the Eiffel Tower in the 3D example', { timeout: 60000 }, async function () {
  const target = await this.page.evaluate(() => {
    const tower = layers._layers.find(entry => entry.layer.model).layer;
    tower._shared._render();
    const rect = map.getContainer().getBoundingClientRect();
    let target;
    tower.traverse(tower.model, mesh => {
      if (target || !mesh.geometry) return;
      const { position, index } = mesh.geometry.attributes;
      const count = index?.count || position.count;
      for (let i = 0; i < count; i += 3) {
        const point = [0, 0, 0];
        for (let j = 0; j < 3; j++) {
          const offset = (index ? index.data[i + j] : i + j) * position.size;
          for (let axis = 0; axis < 3; axis++) point[axis] += position.data[offset + axis];
        }
        const world = new DOMPoint(...point.map(v => v / 3), 1).matrixTransform(new DOMMatrix(mesh.worldMatrix));
        const projected = world.matrixTransform(new DOMMatrix(tower.camera.projectionViewMatrix));
        const x = projected.x / projected.w, y = projected.y / projected.w;
        if (Math.abs(x) > 0.7 || Math.abs(y) > 0.7) continue;
        const candidate = {
          x: Math.round(rect.left + (x + 1) * rect.width / 2),
          y: Math.round(rect.top + (1 - y) * rect.height / 2),
        };
        const event = { clientX: candidate.x, clientY: candidate.y };
        const hit = tower._findFeature(event);
        if (hit?.model !== tower.model ||
            tower.raycast(event, tower.scene.children, true)[0]?.object !== hit.mesh) continue;
        const crs = map.options.crs;
        const origin = crs.project(tower._shared._sceneOrigin);
        const metres = Math.cos(tower._shared._sceneOrigin.lat * Math.PI / 180);
        target = { ...candidate, center: crs.unproject(new L.Point(
          origin.x + hit.point[0] / metres, origin.y - hit.point[2] / metres)),
        zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
        break;
      }
    });
    if (!target) throw new Error('No visible tower triangle available for a mouse click');
    return target;
  });
  await this.page.mouse.move(target.x, target.y);
  await this.page.waitForFunction(() => {
    const tower = layers._layers.find(entry => entry.layer.model).layer;
    return tower._tooltip && !tower._tooltip.hidden &&
      tower.hoveredFeature?.model === tower.model;
  });
  this.exampleTowerHover = await this.page.evaluate(() => {
    const tower = layers._layers.find(entry => entry.layer.model).layer;
    return { text: tower._tooltip.textContent, role: tower._tooltip.getAttribute('role'),
      cursor: map.getContainer().style.cursor };
  });
  const beforeClick = await this.page.evaluate(() => {
    window.exampleClickMovements = 0;
    map.on('movestart zoomstart', () => window.exampleClickMovements++);
    return map.getCenter();
  });
  await this.page.mouse.click(target.x, target.y);
  await this.page.evaluate(() => new Promise(requestAnimationFrame));
  this.exampleTowerZoom = await this.page.evaluate(() => {
    const tower = layers._layers.find(entry => entry.layer.model).layer;
    return { zoom: map.getZoom(), center: map.getCenter(), movements: window.exampleClickMovements,
      clicked: tower.hoveredFeature?.model === tower.model,
      bearing: map.getBearing(), pitch: map.getPitch(),
      canvases: document.querySelectorAll('.leaflet-3d').length };
  });
  this.exampleTowerCenter = beforeClick;
  this.exampleTowerTarget = target;
  await this.page.mouse.move(810, 610);
  await this.page.waitForFunction(() => {
    const tower = layers._layers.find(entry => entry.layer.model).layer;
    return tower._tooltip.hidden && !tower.hoveredFeature &&
      map.getContainer().style.cursor !== 'pointer';
  });
});

Then('the tower information is shown without moving the map or pinning the tooltip', function () {
  const hover = this.exampleTowerHover;
  for (const text of ['Eiffel Tower', '330 m', '300 m structure', '1889', 'Gustave Eiffel', 'Champ de Mars']) {
    assert.ok(hover.text.includes(text), text);
  }
  assert.equal(hover.role, 'tooltip');
  assert.equal(hover.cursor, 'pointer');
  const zoom = this.exampleTowerZoom, target = this.exampleTowerTarget;
  assert.equal(zoom.zoom, target.zoom, 'Clicking does not change the zoom');
  assert.deepEqual(zoom.center, this.exampleTowerCenter, 'Clicking does not move the map');
  assert.equal(zoom.movements, 0);
  assert.equal(zoom.clicked, true);
  assert.equal(zoom.bearing, target.bearing);
  assert.equal(zoom.pitch, target.pitch);
  assert.equal(zoom.canvases, 1);
});

When('I visit and inspect the Eiffel Tower 3D model', { timeout: 60000 }, async function () {
  await this.page.waitForFunction(() =>
    Object.values(map._layers).some(layer => layer.model && layer.renderer),
  null, { timeout: 45000 });
  await this.page.waitForFunction(() => map.getZoom() === 17 && Math.abs(map.getPitch() - 45) < 0.01);
  this.eiffel = await this.page.evaluate(async () => {
    let tower, eiffel;
    map.eachLayer(layer => {
      if (layer.renderer && !layer.model) tower = layer;
      if (layer.model) eiffel = layer;
    });
    const backend = tower;
    const bounds = nativeChecks.bounds(eiffel.model, backend);
    const height = bounds.max[1] - bounds.min[1];
    let meshes = 0;
    backend.traverse(eiffel.model, object => { if (object.geometry) meshes++; });
    const errors = [];
    // Outer ground corners: OSM nodes 33388343, 33388336, 33388327 and 33388350.
    const feet = [
      { local: [60.118438720703125, 0, -60.605037689208984], latlng: [48.8590453, 2.2944834] },
      { local: [60.11847686767578, 0, 60.60499954223633], latlng: [48.8582718, 2.2956897] },
      { local: [-60.118438720703125, 0, 60.605037689208984], latlng: [48.8574753, 2.2945144] },
      { local: [-60.11847686767578, 0, -60.60499954223633], latlng: [48.8582480, 2.2933119] }
    ];
    const footprintErrors = [];
    const tileErrors = [];
    let baseLayer;
    map.eachLayer(layer => {
      if (layer instanceof L.Layer.types.pmtiles && layer._map) baseLayer = layer;
    });
    for (const [zoom, pitch, bearing] of [[17, 0, 0], [17, 45, 30], [18, 60, 135], [16, 80, 270]]) {
      map.setView(tower.location, zoom, { animate: false });
      map.setPitch(pitch);
      map.setBearing(bearing);
      map.panBy([35, -20], { animate: false });
      await new Promise(requestAnimationFrame);
      const scale = map.options.crs.scale(zoom) /
        (40075016.68557849 * Math.cos(tower.location.lat * Math.PI / 180));
      const origin = map.project(tower.location).subtract(map.getPixelOrigin());
      const size = map.getSize();
      for (const [x, z] of [[-40, -40], [0, 0], [40, 40]]) {
        const expected = map.layerPointToContainerPoint(origin.add([x * scale, z * scale]));
        const clip = new DOMPoint(x, 0, z, 1).matrixTransform(new DOMMatrix(tower.camera.projectionViewMatrix));
        const ndcX = clip.x / clip.w, ndcY = clip.y / clip.w;
        const actual = new L.Point((ndcX + 1) * size.x / 2, (1 - ndcY) * size.y / 2);
        errors.push(actual.distanceTo(expected));
      }
      const level = baseLayer._levels[baseLayer._tileZoom];
      const probe = document.createElement('span');
      probe.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0';
      level.el.append(probe);
      const container = map.getContainer();
      const rect = container.getBoundingClientRect();
      const style = getComputedStyle(container);
      const borderX = parseFloat(style.borderLeftWidth);
      const borderY = parseFloat(style.borderTopWidth);
      for (const foot of feet) {
        const transformed = new DOMPoint(...foot.local, 1).matrixTransform(new DOMMatrix(eiffel.model.worldMatrix));
        const world = [transformed.x / transformed.w, transformed.y / transformed.w, transformed.z / transformed.w];
        const geographic = map.unproject(map.project(tower.location).add([world[0] * scale, world[2] * scale]), zoom);
        footprintErrors.push(geographic.distanceTo(new L.LatLng(...foot.latlng)));
        const point = map.project(new L.LatLng(...foot.latlng), baseLayer._tileZoom).subtract(level.origin);
        probe.style.transform = `translate3d(${point.x}px,${point.y}px,0)`;
        const ground = probe.getBoundingClientRect();
        const expected = new L.Point(ground.x - rect.x - borderX, ground.y - rect.y - borderY);
        const clip = new DOMPoint(...world, 1).matrixTransform(new DOMMatrix(tower.camera.projectionViewMatrix));
        const ndcX = clip.x / clip.w, ndcY = clip.y / clip.w;
        const actual = new L.Point((ndcX + 1) * size.x / 2, (1 - ndcY) * size.y / 2);
        tileErrors.push(actual.distanceTo(expected));
      }
      probe.remove();
    }

    const zoomErrors = [];
    let animatedFrames = 0;
    let hiddenFrames = 0;
    const shared = tower._shared;
    const render = shared._render;
    shared._render = function (...args) {
      render.apply(this, args);
      if (!map._animatingZoom) return;
      animatedFrames++;
      if (this.renderer.gl.canvas.hidden) hiddenFrames++;
      const level = tower._shared._zoomLevel;
      const probe = document.createElement('span');
      probe.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0';
      level.el.append(probe);
      const container = map.getContainer();
      const rect = container.getBoundingClientRect();
      const style = getComputedStyle(container);
      const size = map.getSize();
      const scale = map.options.crs.scale(level.zoom) /
        (40075016.68557849 * Math.cos(tower.location.lat * Math.PI / 180));
      const origin = map.project(tower.location, level.zoom).subtract(level.origin);
      for (const [x, z] of [[0, 0], [-40, -40], [40, 40]]) {
        probe.style.transform = `translate3d(${origin.x + x * scale}px,${origin.y + z * scale}px,0)`;
        const ground = probe.getBoundingClientRect();
        const expected = new L.Point(
          ground.x - rect.x - parseFloat(style.borderLeftWidth),
          ground.y - rect.y - parseFloat(style.borderTopWidth)
        );
        const clip = new DOMPoint(x, 0, z, 1).matrixTransform(new DOMMatrix(tower.camera.projectionViewMatrix));
        const ndcX = clip.x / clip.w, ndcY = clip.y / clip.w;
        const actual = new L.Point((ndcX + 1) * size.x / 2, (1 - ndcY) * size.y / 2);
        zoomErrors.push(actual.distanceTo(expected));
      }
      probe.remove();
    };
    map.setView(tower.location, 16, { animate: false });
    map.setPitch(45);
    map.setBearing(30);
    map.panBy([70, -35], { animate: false });
    for (const zoom of [17, 16, 17, 16]) {
      await new Promise(requestAnimationFrame);
      await new Promise(resolve => {
        map.once('zoomend', resolve);
        map.setZoomAround(new L.Point(320, 220), zoom, { animate: true });
      });
    }
    shared._render = render;

    map.setView(tower.location, 17, { animate: false });
    map.setPitch(60);
    map.setBearing(30);
    await new Promise(requestAnimationFrame);
    const renderer = tower.renderer;
    const gl = renderer.gl;
    tower._shared._render();
    const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let visiblePixels = 0;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i]) visiblePixels++;
    }
    const clickThrough = getComputedStyle(renderer.gl.canvas).pointerEvents === 'none';
    map.removeLayer(tower);
    const sharedCanvasRemains = document.querySelector('.leaflet-3d') === eiffel.renderer.gl.canvas;
    map.removeLayer(eiffel);
    const other3d = [];
    map.eachLayer(layer => { if (layer instanceof L.Layer.types['3d']) other3d.push(layer); });
    other3d.forEach(layer => layer.remove());
    const removed = !document.querySelector('.leaflet-3d');
    tower.addTo(map);
    eiffel.addTo(map);
    other3d.forEach(layer => layer.addTo(map));
    return {
      height, meshes, errors, footprintErrors, tileErrors, zoomErrors, animatedFrames, hiddenFrames,
      visiblePixels, clickThrough, removed, sharedCanvasRemains,
      restored: tower.renderer.width === map.getSize().x && tower.renderer.height === map.getSize().y,
      latitude: eiffel.location.lat,
      longitude: eiffel.location.lng
    };
  });
});

Then('the tower is rendered at its geographic position through camera changes', function () {
  const result = this.eiffel;
  assert.ok(result.height > 299 && result.height < 301, JSON.stringify(result));
  assert.ok(result.meshes > 1, JSON.stringify(result));
  assert.ok(Math.max(...result.errors) < 1.5, `Logical coordinate rounding errors: ${result.errors}`);
  assert.ok(Math.max(...result.footprintErrors) < 0.5, `Footprint errors in metres: ${result.footprintErrors}`);
  assert.ok(Math.max(...result.tileErrors) < 2, `Tile alignment errors in pixels: ${result.tileErrors}`);
  assert.ok(result.animatedFrames >= 4, `Too few animated zoom frames: ${result.animatedFrames}`);
  assert.equal(result.hiddenFrames, 0);
  assert.ok(Math.max(...result.zoomErrors) < 0.1, `Animated tile alignment errors: ${result.zoomErrors}`);
  assert.ok(result.visiblePixels > 1000, JSON.stringify(result));
  assert.equal(result.latitude, 48.8582601);
  assert.equal(result.longitude, 2.29449985);
  assert.equal(result.clickThrough, true);
  assert.equal(result.removed, true);
  assert.equal(result.sharedCanvasRemains, true);
  assert.equal(result.restored, true);
});
