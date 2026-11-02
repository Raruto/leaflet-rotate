function T(e={},t=!1,x=""){const n=!!e.baseTexture,l=!!e.metalTexture,c=!!e.emissiveTexture,u=!!e.occlusionTexture,o=!!e.roofTexture,s=!!e.terrain,i=n||l||c||u||e.nightLight,p=`
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
    ${s?`@group(0) @binding(2) var dem: texture_2d<f32>;${x}`:""}
    struct VertexInput {
      @location(0) position: vec3<f32>,
      @location(1) normal: vec3<f32>,
      ${e.vertexColors?"@location(2) color: vec3<f32>,":""}
      ${i?"@location(3) uv: vec2<f32>,":""}
    };
    struct VertexOutput {
      @builtin(position) position: vec4<f32>,
      @location(0) color: vec3<f32>,
      @location(1) normal: vec3<f32>,
      @location(2) viewPosition: vec3<f32>,
      @location(6) shadowPosition: vec4<f32>,
      @location(7) worldPosition: vec3<f32>,
      ${t?"@location(8) localPosition: vec3<f32>,":""}
      ${i?"@location(3) uv: vec2<f32>,":""}
      ${o?"@location(4) roofUv: vec2<f32>, @location(5) roof: f32,":""}
    };
    @vertex fn vertexMain(input: VertexInput, @builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
      var output: VertexOutput;
      var position = input.position;
      ${s?"position.y = elevation(u.terrain.xy + input.uv * u.terrain.z, u.terrain.w) - u.terrain.w;":""}
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
      ${t?"output.localPosition = input.position;":""}
      let viewPosition = frame.viewMatrix * world;
      output.viewPosition = viewPosition.xyz;
      ${i?"output.uv = input.uv;":""}
      ${o?`
        output.roofUv = (frame.roofMatrix * world).xz;
        output.roof = select(0.0, 1.0, input.normal.y >= 0.5 && !highlighted);
      `:""}
      output.position = frame.projectionMatrix * viewPosition;
      return output;
    }
  `,v=[];let a=3;const r=(f,$)=>{if(!$)return"";v.push({name:f,texture:a,sampler:a+1});const m=a;return a+=2,`@group(0) @binding(${m}) var ${f}: texture_2d<f32>;
      @group(0) @binding(${m+1}) var ${f}Sampler: sampler;`},g=r("baseTexture",n),d=r("metalTexture",l),h=r("emissiveTexture",c),w=r("occlusionTexture",u),b=r("roofTexture",o),y=`
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
    struct Solar {
      matrix: mat4x4<f32>,
      params: vec4<f32>,
    };
    @group(0) @binding(0) var<uniform> u: Mesh;
    @group(0) @binding(1) var<uniform> frame: Frame;
    @group(1) @binding(0) var<uniform> solar: Solar;
    @group(1) @binding(1) var shadowTexture: texture_depth_2d;
    @group(1) @binding(2) var shadowSampler: sampler_comparison;
    @group(1) @binding(3) var<storage, read> lightGrid: array<vec4<f32>>;
    ${g}${d}${h}${w}${b}
    struct FragmentInput {
      @location(0) color: vec3<f32>,
      @location(1) normal: vec3<f32>,
      @location(2) viewPosition: vec3<f32>,
      @location(6) shadowPosition: vec4<f32>,
      @location(7) worldPosition: vec3<f32>,
      ${t?"@location(8) localPosition: vec3<f32>,":""}
      ${i?"@location(3) uv: vec2<f32>,":""}
      ${o?"@location(4) roofUv: vec2<f32>, @location(5) roof: f32,":""}
    };
    const PI: f32 = 3.14159265;
    fn toLinear(c: vec3<f32>) -> vec3<f32> {
      return select(c / 12.92, pow((c + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4)), c >= vec3<f32>(0.04045));
    }
    fn toSRGB(c: vec3<f32>) -> vec3<f32> {
      return select(c * 12.92, 1.055 * pow(max(c, vec3<f32>(0.0)), vec3<f32>(1.0 / 2.4)) - vec3<f32>(0.055), c >= vec3<f32>(0.0031308));
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
      let worldNormal = normalize(transpose(mat3x3<f32>(frame.viewMatrix[0].xyz, frame.viewMatrix[1].xyz, frame.viewMatrix[2].xyz)) * normalize(input.normal)) * select(-1.0, 1.0, frontFacing);
      let artificial = localLighting(input.worldPosition, worldNormal);
      ${e.unlit?`
        let rasterTexel = textureSample(baseTexture, baseTextureSampler, input.uv);
        return vec4<f32>(toSRGB(toLinear(rasterTexel.rgb) * (frame.atmosphereTint.rgb * (0.55 + 0.45 * sunlight) + artificial)), ${e.alphaMode==="BLEND"?"u.material.z * rasterTexel.a":"1.0"});
      `:`
      var normal = normalize(input.normal) * select(-1.0, 1.0, frontFacing);
      let texel = ${n?"textureSample(baseTexture, baseTextureSampler, input.uv)":"vec4<f32>(1.0)"};
      let alpha = u.material.z * texel.a;
      ${e.alphaMode==="MASK"?"if (alpha < u.material.w) { discard; }":""}
      ${e.alphaMode==="BLEND"?"if (alpha < 0.01) { discard; }":""}
      var base = ${e.vertexColors?"toLinear(min(input.color, vec3<f32>(1.0)))":"input.color"} *
        ${e.baseTexture?.srgb?"texel.rgb":"toLinear(texel.rgb)"};
      ${o?`
        if (input.roof > 0.5 && all(input.roofUv >= vec2<f32>(0.0)) &&
          all(input.roofUv <= vec2<f32>(1.0))) {
          let roof = textureSampleLevel(roofTexture, roofTextureSampler, input.roofUv, 0.0);
          base = mix(base, toLinear(roof.rgb), roof.a);
        }
      `:""}
      let mr = ${l?"textureSample(metalTexture, metalTextureSampler, input.uv)":"vec4<f32>(1.0)"};
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
      let ao = ${u?"mix(1.0, textureSample(occlusionTexture, occlusionTextureSampler, input.uv).r, u.emissive.w)":"1.0"};
      ${t?`
        let lattice = (fract(input.localPosition / 2.5) - 0.5) * 2.5;
        let pointGlow = (1.0 - smoothstep(0.16, 0.42, length(lattice))) * u.highlight.z;
      `:""}
      // Vertex colour components above 1 are self-lit (e.g. vehicle lamps): dim by day, bright at night.
      let glow = ${t?"vec3<f32>(3.0, 2.6, 1.8) * pointGlow +":""}${e.vertexColors?" max(input.color - vec3<f32>(1.0), vec3<f32>(0.0)) * (0.3 + 5.0 * frame.skyDirection.w) +":""} u.emissive.rgb * ${c?e.emissiveTexture.srgb?"textureSample(emissiveTexture, emissiveTextureSampler, input.uv).rgb":"toLinear(textureSample(emissiveTexture, emissiveTextureSampler, input.uv).rgb)":"vec3<f32>(1.0)"};
      var color = ambient * base * (1.0 - metal) * ao +
        (diffuse + specular) * nl * toLinear(vec3<f32>(1.0, 0.937, 0.835)) * 3.0 + glow;
      ${e.vertexColors?"color = base * (ambient + toLinear(vec3<f32>(1.0, 0.937, 0.835)) * (3.0 / PI) * nl) + glow;":""}
      color = (color - glow) * frame.atmosphereTint.rgb + base * artificial * (1.0 - metal * 0.5) + glow;
      return vec4<f32>(toSRGB(color), ${e.alphaMode==="BLEND"?"alpha":"1.0"});
      `}
    }
  `;return{vertex:p,fragment:y,bindings:v,textured:i,hasTerrain:s}}export{T as materialShaders};
//# sourceMappingURL=shaders.js.map
