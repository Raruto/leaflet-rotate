import{emptyNode as _}from"./empty-node.js";var B={async _attach(e){let t=L.Layer.types["3d"]._renderers.get(e);if(t?._rendererReady&&await t._rendererReady.promise,!t){const r=Promise.withResolvers();t=this,this._rendererReady=r,r.promise.catch(()=>{}),L.Layer.types["3d"]._renderers.set(e,t);const i=d=>{throw r.reject(d),L.Layer.types["3d"]._renderers.delete(e),d},p=document.createElement("canvas");navigator.gpu||i(new Error("Layer3D requires WebGPU"));const f=await navigator.gpu.requestAdapter().catch(i);f||i(new Error("Unable to acquire a WebGPU adapter"));const o=await f.requestDevice().catch(i);o.addEventListener("uncapturederror",d=>{const x=L.Layer.types["3d"]._renderers.get(e);for(const y of x?._layers||[])y.fire("error",{error:d.error})}),o.lost.then(d=>{const x=L.Layer.types["3d"]._renderers.get(e);if(!x)return;const y=new Error(`WebGPU device lost: ${d.message||d.reason}`);for(const c of x._layers)c.fire("error",{error:y})});const u=p.getContext("webgpu");u||(o.destroy(),i(new Error("Unable to create a WebGPU canvas context")));const a=navigator.gpu.getPreferredCanvasFormat();u.configure({device:o,format:a,alphaMode:"premultiplied"}),this._shared=this,this._layers=new Set,this._sceneOrigin=this.location,this.scene=_(),this.camera={position:[0,0,0],up:[0,1,0],target:[0,0,0],viewMatrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],projectionMatrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],projectionViewMatrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],fov:45,aspect:1,near:.1,far:1e4},this.renderer={device:o,context:u,format:a,canvas:p,dpr:Math.min(window.devicePixelRatio,2)},this._initSunlight();const s=document.createElement("canvas");s.width=1,s.height=1,this.renderer.roofFallbackTexture={device:o,texture:o.createTexture({size:[1,1],format:"rgba8unorm",usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT}),sampler:o.createSampler({addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"}),image:s,format:"rgba8unorm",srgb:!1,uploaded:null},t._size=null,p.className="leaflet-3d",p.style.cssText="position:absolute;top:0;left:0;pointer-events:none",p.setAttribute("role","img"),p.setAttribute("aria-label",this.options.ariaLabel);let n=e.getPane("webgpuPane");n||(n=e.createPane("webgpuPane",e.getContainer()),n.style.zIndex=450),n.append(p),e.on("move zoom rotate pitch resize viewreset layeradd layerremove",t._onMapChange,t),e.on("zoomstart",t._startZoom,t),e.on("zoomanim",t.update,t),e.on("zoomend",t._endZoom,t),r.resolve(),delete t._rendererReady,t._render(),L.Layer.types["3d"]._renderers.set(e,t)}const m=e.options.crs.project(t._sceneOrigin),v=e.options.crs.project(this.location),l=Math.cos(t._sceneOrigin.lat*Math.PI/180);this._terrainBaseY??=this.root.position[1],this.root.position[0]=(v.x-m.x)*l,this.root.position[1]=this._terrainBaseY,this.root.position[2]=-(v.y-m.y)*l,this._setTerrainHeight(),this.root.scale.fill(l/Math.cos(this.location.lat*Math.PI/180)),this._shared=t,this.renderer=t.renderer,this.scene=t.scene,this.camera=t.camera,t._layers.add(this),this.setParent(this.root,t.scene),this.traverse(this.root,r=>{if(r.geometry&&r.geometry.device!==t.renderer.device){const i=r.geometry,p=r.program._layerMaterial,f={};for(const u of["position","normal","color","uv","index"]){const a=i.attributes[u];if(!a)continue;const{data:s,size:n,count:d,normalized:x}=a;f[u]={data:s.slice(0,d*n),size:n,normalized:x}}const o=t.renderer.device;f.index?.data instanceof Uint8Array&&(f.index.data=Uint16Array.from(f.index.data));for(const[u,a]of Object.entries(f))a.size||=1,a.count=a.data.length/a.size,a.indexFormat=a.data instanceof Uint32Array?"uint32":"uint16",a.buffer=o.createBuffer({size:Math.max(4,a.data.byteLength),usage:u==="index"?GPUBufferUsage.INDEX|GPUBufferUsage.COPY_DST:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST}),o.queue.writeBuffer(a.buffer,0,a.data);r.geometry={device:o,attributes:f,drawRange:{start:0,count:f.index?.count||f.position.count}};for(const u of Object.values(i.attributes))u.buffer.destroy();r.bindGroup=null,r.boundTextures=[];for(const u of["baseTexture","metalTexture","emissiveTexture","occlusionTexture"]){const a=p[u];!a||a.device===o||(p[u]={...a,device:o,texture:o.createTexture({size:[a.image.width,a.image.height],format:a.format,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT}),sampler:o.createSampler(a.samplerOptions),uploaded:null})}this._removeProgram(r.program),r.program=this._createProgram(p),r.device=o}r.texture&&r.texture.device!==t.renderer.device&&(r.texture={...r.texture,device:t.renderer.device,texture:t.renderer.device.createTexture({size:[r.texture.image.width,r.texture.image.height],format:r.texture.format,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT}),sampler:t.renderer.device.createSampler(r.texture.samplerOptions),uploaded:null})}),t.update(),this.header&&this._updateArea()},_destroyTexture(e){this.renderer.device.queue.onSubmittedWorkDone().then(()=>e.destroy(),t=>{this.fire("error",{error:t}),e.destroy()})},_createProgram(e={}){const t=this.renderer.device,m=!!e.baseTexture,v=!!e.metalTexture,l=!!e.emissiveTexture,r=!!e.occlusionTexture,i=!!e.roofTexture,p=!!e.terrain,f=m||v||l||r||e.nightLight,o=!!this.options.nightSparkle,u=t.createShaderModule({code:`
      struct Mesh {
        worldMatrix: mat4x4<f32>,
        baseColor: vec4<f32>,
        material: vec4<f32>,
        emissive: vec4<f32>,
        terrain: vec4<f32>,
        highlight: vec4<f32>,
      };
      struct Frame {
        viewMatrix: mat4x4<f32>,
        projectionMatrix: mat4x4<f32>,
        roofMatrix: mat4x4<f32>,
        lightDirection: vec4<f32>,
        skyDirection: vec4<f32>,
        atmosphereTint: vec4<f32>,
      };
      @group(0) @binding(0) var<uniform> u: Mesh;
      @group(0) @binding(1) var<uniform> frame: Frame;
      struct Solar { matrix: mat4x4<f32>, params: vec4<f32> };
      @group(1) @binding(0) var<uniform> solar: Solar;
      ${p?`@group(0) @binding(2) var dem: texture_2d<f32>;${L.Layer.types.terrain.elevationWGSL}`:""}
      struct VertexInput {
        @location(0) position: vec3<f32>,
        @location(1) normal: vec3<f32>,
        ${e.vertexColors?"@location(2) color: vec3<f32>,":""}
        ${f?"@location(3) uv: vec2<f32>,":""}
      };
      struct VertexOutput {
        @builtin(position) position: vec4<f32>,
        @location(0) color: vec3<f32>,
        @location(1) normal: vec3<f32>,
        @location(2) viewPosition: vec3<f32>,
        @location(6) shadowPosition: vec4<f32>,
        @location(7) worldPosition: vec3<f32>,
        ${o?"@location(8) localPosition: vec3<f32>,":""}
        ${f?"@location(3) uv: vec2<f32>,":""}
        ${i?"@location(4) roofUv: vec2<f32>, @location(5) roof: f32,":""}
      };
      @vertex fn vertexMain(input: VertexInput, @builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
        var output: VertexOutput;
        var position = input.position;
        ${p?"position.y = elevation(u.terrain.xy + input.uv * u.terrain.z, u.terrain.w) - u.terrain.w;":""}
        let highlighted = f32(vertexIndex) >= u.highlight.x && f32(vertexIndex) < u.highlight.y;
        output.color = ${e.vertexColors?"select(input.color, vec3<f32>(72.0 / 255.0, 217.0 / 255.0, 1.0), highlighted)":"u.baseColor.rgb"};
        // Inverse-transpose from cofactors; the camera view matrix is orthonormal.
        let m = mat3x3<f32>(u.worldMatrix[0].xyz, u.worldMatrix[1].xyz, u.worldMatrix[2].xyz);
        let normal = (cross(m[1], m[2]) * input.normal.x + cross(m[2], m[0]) * input.normal.y +
          cross(m[0], m[1]) * input.normal.z) / determinant(m);
        output.normal = (frame.viewMatrix * vec4<f32>(normal, 0.0)).xyz;
        let world = u.worldMatrix * vec4<f32>(position, 1.0);
        output.shadowPosition = solar.matrix * world;
        output.worldPosition = world.xyz / world.w;
        ${o?"output.localPosition = input.position;":""}
        let viewPosition = frame.viewMatrix * world;
        output.viewPosition = viewPosition.xyz;
        ${f?"output.uv = input.uv;":""}
        ${i?`
          output.roofUv = (frame.roofMatrix * world).xz;
          output.roof = select(0.0, 1.0, input.normal.y >= 0.5 && !highlighted);
        `:""}
        output.position = frame.projectionMatrix * viewPosition;
        return output;
      }
    `}),a=[];let s=3;const n=(b,M)=>{if(!M)return"";a.push({name:b,texture:s,sampler:s+1});const T=s;return s+=2,`@group(0) @binding(${T}) var ${b}: texture_2d<f32>;
        @group(0) @binding(${T+1}) var ${b}Sampler: sampler;`},d=n("baseTexture",m),x=n("metalTexture",v),y=n("emissiveTexture",l),c=n("occlusionTexture",r),g=n("roofTexture",i),h=t.createShaderModule({code:`
      struct Mesh {
        worldMatrix: mat4x4<f32>,
        baseColor: vec4<f32>,
        material: vec4<f32>,
        emissive: vec4<f32>,
        terrain: vec4<f32>,
        highlight: vec4<f32>,
      };
      struct Frame {
        viewMatrix: mat4x4<f32>,
        projectionMatrix: mat4x4<f32>,
        roofMatrix: mat4x4<f32>,
        lightDirection: vec4<f32>,
        skyDirection: vec4<f32>,
        atmosphereTint: vec4<f32>,
      };
      @group(0) @binding(0) var<uniform> u: Mesh;
      @group(0) @binding(1) var<uniform> frame: Frame;
      struct Solar { matrix: mat4x4<f32>, params: vec4<f32> };
      @group(1) @binding(0) var<uniform> solar: Solar;
      @group(1) @binding(1) var shadowTexture: texture_depth_2d;
      @group(1) @binding(2) var shadowSampler: sampler_comparison;
      @group(1) @binding(3) var<storage, read> lightGrid: array<vec4<f32>>;
      ${d}${x}${y}${c}${g}
      struct FragmentInput {
        @location(0) color: vec3<f32>,
        @location(1) normal: vec3<f32>,
        @location(2) viewPosition: vec3<f32>,
        @location(6) shadowPosition: vec4<f32>,
        @location(7) worldPosition: vec3<f32>,
        ${o?"@location(8) localPosition: vec3<f32>,":""}
        ${f?"@location(3) uv: vec2<f32>,":""}
        ${i?"@location(4) roofUv: vec2<f32>, @location(5) roof: f32,":""}
      };
      const PI: f32 = 3.14159265;
      fn toLinear(c: vec3<f32>) -> vec3<f32> {
        return select(c / 12.92, pow((c + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4)),
          c >= vec3<f32>(0.04045));
      }
      fn toSRGB(c: vec3<f32>) -> vec3<f32> {
        return select(c * 12.92, 1.055 * pow(max(c, vec3<f32>(0.0)), vec3<f32>(1.0 / 2.4)) - vec3<f32>(0.055),
          c >= vec3<f32>(0.0031308));
      }
      fn sunVisibility(position: vec4<f32>) -> f32 {
        let p = position.xyz / position.w;
        let uv = vec2<f32>(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
        if (solar.params.x < 0.5 || any(uv < vec2<f32>(0.0)) || any(uv > vec2<f32>(1.0)) || p.z < 0.0 || p.z > 1.0) {
          return 1.0;
        }
        return textureSampleCompareLevel(shadowTexture, shadowSampler, uv, p.z - 0.0003);
      }
      fn localLighting(position: vec3<f32>, normal: vec3<f32>) -> vec3<f32> {
        if (frame.skyDirection.w <= 0.0 || lightGrid[0].w < 1.0) { return vec3<f32>(0.0); }
        let cell = vec2<i32>(floor((position.xz - lightGrid[0].xy) / lightGrid[0].z));
        if (any(cell < vec2<i32>(0)) || cell.x >= i32(lightGrid[0].w) || cell.y >= i32(lightGrid[1].x)) {
          return vec3<f32>(0.0);
        }
        let header = lightGrid[2u + u32(cell.y) * u32(lightGrid[0].w) + u32(cell.x)];
        var light = vec3<f32>(0.0);
        for (var i = 0u; i < u32(header.y); i++) {
          let source = lightGrid[u32(header.x) + i * 2u];
          let colour = lightGrid[u32(header.x) + i * 2u + 1u];
          let delta = source.xyz - position;
          let distance2 = max(dot(delta, delta), 1.0);
          let falloff = max(0.0, 1.0 - distance2 / (source.w * source.w));
          let lambert = max(0.0, dot(normal, delta / sqrt(distance2)));
          light += toLinear(colour.rgb) * colour.w * lambert * falloff * falloff / distance2;
        }
        return light * frame.skyDirection.w;
      }
      @fragment fn fragmentMain(input: FragmentInput, @builtin(front_facing) frontFacing: bool) -> @location(0) vec4<f32> {
        ${e.nightLight?`
          if (input.uv.x <= 2.0) {
          let radial = max(0.0, 1.0 - dot(input.uv, input.uv));
          let alpha = radial * radial * frame.skyDirection.w * 0.65;
          if (alpha < 0.005) { discard; }
          return vec4<f32>(input.color, alpha);
          }
        `:""}
        let sunlight = sunVisibility(input.shadowPosition);
        let worldNormal = normalize(transpose(mat3x3<f32>(frame.viewMatrix[0].xyz,
          frame.viewMatrix[1].xyz, frame.viewMatrix[2].xyz)) * normalize(input.normal)) * select(-1.0, 1.0, frontFacing);
        let artificial = localLighting(input.worldPosition, worldNormal);
        ${e.unlit?`
          let rasterTexel = textureSample(baseTexture, baseTextureSampler, input.uv);
          return vec4<f32>(toSRGB(toLinear(rasterTexel.rgb) * (frame.atmosphereTint.rgb * (0.55 + 0.45 * sunlight) + artificial)), ${e.alphaMode==="BLEND"?"u.material.z * rasterTexel.a":"1.0"});
        `:`
        var normal = normalize(input.normal) * select(-1.0, 1.0, frontFacing);
        let texel = ${m?"textureSample(baseTexture, baseTextureSampler, input.uv)":"vec4<f32>(1.0)"};
        let alpha = u.material.z * texel.a;
        ${e.alphaMode==="MASK"?"if (alpha < u.material.w) { discard; }":""}
        ${e.alphaMode==="BLEND"?"if (alpha < 0.01) { discard; }":""}
        var base = ${e.vertexColors?"toLinear(input.color)":"input.color"} *
          ${e.baseTexture?.srgb?"texel.rgb":"toLinear(texel.rgb)"};
        ${i?`
          if (input.roof > 0.5 && all(input.roofUv >= vec2<f32>(0.0)) &&
            all(input.roofUv <= vec2<f32>(1.0))) {
            let roof = textureSampleLevel(roofTexture, roofTextureSampler, input.roofUv, 0.0);
            base = mix(base, toLinear(roof.rgb), roof.a);
          }
        `:""}
        let mr = ${v?"textureSample(metalTexture, metalTextureSampler, input.uv)":"vec4<f32>(1.0)"};
        let metal = clamp(u.material.x * mr.b, 0.0, 1.0);
        let rough = clamp(u.material.y * mr.g, 0.08, 1.0);
        let view = normalize(-input.viewPosition);
        let halfVector = normalize(view + frame.lightDirection.xyz);
        let nl = max(dot(normal, frame.lightDirection.xyz), 0.0) * frame.lightDirection.w * sunlight;
        let nv = max(dot(normal, view), 0.001);
        let nh = max(dot(normal, halfVector), 0.0);
        let vh = max(dot(view, halfVector), 0.0);
        let a2 = pow(rough, 4.0);
        let d = a2 / max(PI * pow(nh * nh * (a2 - 1.0) + 1.0, 2.0), 0.0001);
        let gv = nl * sqrt(nv * nv * (1.0 - a2) + a2);
        let gl = nv * sqrt(nl * nl * (1.0 - a2) + a2);
        let visibility = 0.5 / max(gv + gl, 0.0001);
        let f0 = mix(vec3<f32>(0.04), base, metal);
        let fresnel = f0 + (1.0 - f0) * pow(1.0 - vh, 5.0);
        let specular = d * visibility * fresnel;
        let diffuse = (1.0 - metal) * base / PI;
        let sky = dot(normal, frame.skyDirection.xyz) * 0.5 + 0.5;
        let ambient = mix(toLinear(vec3<f32>(0.455, 0.412, 0.322)), vec3<f32>(1.0), sky) * (2.0 / PI);
        let ao = ${r?"mix(1.0, textureSample(occlusionTexture, occlusionTextureSampler, input.uv).r, u.emissive.w)":"1.0"};
        ${o?`
          let lattice = (fract(input.localPosition / 2.5) - 0.5) * 2.5;
          let pointGlow = (1.0 - smoothstep(0.16, 0.42, length(lattice))) * u.highlight.z;
        `:""}
        let glow = ${o?"vec3<f32>(3.0, 2.6, 1.8) * pointGlow +":""} u.emissive.rgb * ${l?e.emissiveTexture.srgb?"textureSample(emissiveTexture, emissiveTextureSampler, input.uv).rgb":"toLinear(textureSample(emissiveTexture, emissiveTextureSampler, input.uv).rgb)":"vec3<f32>(1.0)"};
        var color = ambient * base * (1.0 - metal) * ao +
          (diffuse + specular) * nl * toLinear(vec3<f32>(1.0, 0.937, 0.835)) * 3.0 + glow;
        ${e.vertexColors?"color = base * (ambient + toLinear(vec3<f32>(1.0, 0.937, 0.835)) * (3.0 / PI) * nl) + glow;":""}
        color = (color - glow) * frame.atmosphereTint.rgb + base * artificial * (1.0 - metal * 0.5) + glow;
        return vec4<f32>(toSRGB(color), ${e.alphaMode==="BLEND"?"alpha":"1.0"});
        `}
      }
    `});Promise.all([u.getCompilationInfo(),h.getCompilationInfo()]).then(b=>{const M=b.flatMap(T=>T.messages).filter(T=>T.type==="error");M.length&&this.fire("error",{error:new Error(`Unable to compile Layer3D WGSL: ${M.map(T=>T.message).join(`
`)}`)})}).catch(b=>this.fire("error",{error:b}));const P=[{arrayStride:12,attributes:[{shaderLocation:0,offset:0,format:"float32x3"}]},{arrayStride:12,attributes:[{shaderLocation:1,offset:0,format:"float32x3"}]},e.vertexColors?{arrayStride:12,attributes:[{shaderLocation:2,offset:0,format:"float32x3"}]}:null,f?{arrayStride:8,attributes:[{shaderLocation:3,offset:0,format:"float32x2"}]}:null],w=[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform",hasDynamicOffset:!0}},{binding:1,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}];p&&w.push({binding:2,visibility:GPUShaderStage.VERTEX,texture:{sampleType:"unfilterable-float",viewDimension:"2d"}});for(const b of a)w.push({binding:b.texture,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"float",viewDimension:"2d"}}),w.push({binding:b.sampler,visibility:GPUShaderStage.FRAGMENT,sampler:{type:"filtering"}});const S=t.createBindGroupLayout({entries:w}),G=t.createPipelineLayout({bindGroupLayouts:[S,this.renderer.sunlight.layout]});return{device:t,vertex:u,fragment:h,bindings:a,vertexBuffers:P,bindGroupLayout:S,pipelineLayout:G,pipelineCache:new Map,cullMode:e.doubleSided?"none":"back",transparent:e.alphaMode==="BLEND",depthWrite:e.alphaMode!=="BLEND",depthTest:e.depthTest!==!1,terrain:e.terrain,nightLight:!!e.nightLight,nightSparkle:o,uniforms:{baseColor:{value:e.color||[1,1,1]},metallic:{value:e.metallic??0},roughness:{value:e.roughness??.85},opacity:{value:e.opacity??1},alphaCutoff:{value:e.alphaCutoff??.5},occlusionStrength:{value:e.occlusionStrength??1},emissive:{value:e.emissive||[0,0,0]},...m?{baseTexture:{value:e.baseTexture}}:{},...v?{metalTexture:{value:e.metalTexture}}:{},...l?{emissiveTexture:{value:e.emissiveTexture}}:{},...r?{occlusionTexture:{value:e.occlusionTexture}}:{},...i?{roofTexture:{value:null}}:{}},_layerMaterial:e}},_removeProgram(e){e.pipelineCache.clear()},_computeBounds(e){const t=[1/0,1/0,1/0],m=[-1/0,-1/0,-1/0],v=e.attributes.position.data;for(let i=0;i<v.length;i++)t[i%3]=Math.min(t[i%3],v[i]),m[i%3]=Math.max(m[i%3],v[i]);const l=t.map((i,p)=>(i+m[p])/2);let r=0;for(let i=0;i<v.length;i+=3)r=Math.max(r,Math.hypot(v[i]-l[0],v[i+1]-l[1],v[i+2]-l[2]));e.bounds={min:t,max:m,center:l,radius:r}},_drawGeometry(e,t,m,v){const{geometry:l,program:r}=e,i=this.renderer.device,p=`${m}:${v}`;let f=r.pipelineCache.get(p);f||(f=i.createRenderPipeline({layout:r.pipelineLayout,vertex:{module:r.vertex,entryPoint:"vertexMain",buffers:r.vertexBuffers},fragment:{module:r.fragment,entryPoint:"fragmentMain",targets:[{format:this.renderer.format,blend:r.transparent?{color:{srcFactor:"src-alpha",dstFactor:"one-minus-src-alpha",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one-minus-src-alpha",operation:"add"}}:void 0,writeMask:GPUColorWrite.ALL}]},primitive:{topology:"triangle-list",cullMode:m,frontFace:v},depthStencil:{format:"depth24plus",depthWriteEnabled:r.depthWrite,depthCompare:r.depthTest===!1?"always":"less-equal"}}),r.pipelineCache.set(p,f));const o=r.uniforms,u=this.renderer,a=u.uniformSlot++*256,s=u.uniformData,n=a/4;s.set(e.worldMatrix,n),s.set(o.baseColor.value,n+16),s[n+19]=1,s[n+20]=o.metallic.value,s[n+21]=o.roughness.value,s[n+22]=o.opacity.value,s[n+23]=o.alphaCutoff.value,s.set(o.emissive.value,n+24),s[n+27]=o.occlusionStrength.value,s[n+28]=e.terrain?.[0]??0,s[n+29]=e.terrain?.[1]??0,s[n+30]=e.terrain?.[2]??0,s[n+31]=e.terrain?.[3]??0,s[n+32]=e.highlight?.[0]??0,s[n+33]=e.highlight?.[1]??0,s[n+34]=r.nightSparkle?s[55]:0,s[n+35]=0;const d=e._textures||=[];d.length=0;for(const c of r.bindings){const g=o[c.name]?.value;if(!g)throw new Error(`Missing Layer3D texture: ${c.name}`);g.uploaded!==g.image&&(i.queue.copyExternalImageToTexture({source:g.image,flipY:!!g.flipY},{texture:g.texture},[g.image.width,g.image.height]),g.uploaded=g.image),d.push(g)}let x=!e.bindGroup||e.boundBuffer!==u.uniformBuffer||d.length!==e.boundTextures.length;for(let c=0;!x&&c<d.length;c++)(d[c].texture!==e.boundTextures[c][0]||d[c].sampler!==e.boundTextures[c][1])&&(x=!0);if(x){const c=[{binding:0,resource:{buffer:u.uniformBuffer,size:144}},{binding:1,resource:{buffer:u.uniformBuffer,size:240}}];r.terrain&&c.push({binding:2,resource:r.terrain.texture.createView()}),e.boundBuffer=u.uniformBuffer;const g=e.boundTextures||=[];g.length=d.length;for(let h=0;h<d.length;h++){const P=r.bindings[h],w=d[h];c.push({binding:P.texture,resource:w.texture.createView()}),c.push({binding:P.sampler,resource:w.sampler}),g[h]||=[],g[h][0]=w.texture,g[h][1]=w.sampler}e.bindGroup=i.createBindGroup({layout:r.bindGroupLayout,entries:c})}t.setPipeline(f),t.setBindGroup(0,e.bindGroup,[a]),t.setVertexBuffer(0,l.attributes.position.buffer),t.setVertexBuffer(1,l.attributes.normal.buffer),l.attributes.color&&t.setVertexBuffer(2,l.attributes.color.buffer),l.attributes.uv&&t.setVertexBuffer(3,l.attributes.uv.buffer);for(const c of Object.values(l.attributes))c.needsUpdate&&(i.queue.writeBuffer(c.buffer,0,c.data),c.needsUpdate=!1,l.bounds=null);const y=l.attributes.index;y?(t.setIndexBuffer(y.buffer,y.indexFormat),t.drawIndexed(l.drawRange.count,1,l.drawRange.start,0,0)):t.draw(l.drawRange.count,1,l.drawRange.start,0)}};export{B as default};
//# sourceMappingURL=gpu.js.map
