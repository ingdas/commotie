/*
 * NormalMapScene — WebGL2 POC
 * -----------------------------------------------------------------------------
 * Normal-map (bump) verlichting + wind-animatie op 2D sprites.
 * Geïnspireerd door Factorio FFF-324.
 *
 * Kernidee:
 *   1. De "normal map" wordt in de fragment shader afgeleid uit de sprite zelf
 *      (Sobel-filter op de helderheid). Zo werkt elke afbeelding zonder dat je
 *      een aparte normal-map hoeft te tekenen.
 *   2. Een bewegende lichtbron veegt over de genormaliseerde oppervlakken heen
 *      -> dat geeft het "levende" glinstereffect (de normal-map animatie).
 *   3. Wind-sway vervormt de vertices; de vervorming wordt sterker naar de top
 *      (boomkroon, grastop) zodat het natuurlijk buigt.
 *
 * Gebruik:
 *   const scene = new NormalMapScene(canvasElement);
 *   scene.start();
 *   scene.params.windAmp = 40;          // live aanpasbaar
 *   scene.loadImageFromFile(file, 'tree'); // eigen boom/gras inladen
 *
 * Geen externe dependencies. Zuiver WebGL2.
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------------------
  // GL helpers
  // ---------------------------------------------------------------------------
  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error('Shader compile error:\n' + gl.getShaderInfoLog(s) + '\n' + src);
    }
    return s;
  }

  function program(gl, vsSrc, fsSrc) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error('Program link error:\n' + gl.getProgramInfoLog(p));
    }
    return p;
  }

  function uniforms(gl, p) {
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      u[info.name] = gl.getUniformLocation(p, info.name);
    }
    return u;
  }

  // Orthografische projectie: wereld (0..W, 0..H, y omhoog) -> clip space.
  function ortho(W, H) {
    return new Float32Array([
      2 / W, 0, 0, 0,
      0, 2 / H, 0, 0,
      0, 0, -1, 0,
      -1, -1, 0, 1,
    ]);
  }

  // ---------------------------------------------------------------------------
  // Procedurele fallback-texturen (zodat de POC meteen draait zonder assets).
  // ---------------------------------------------------------------------------
  function makeTreeCanvas() {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const x = c.getContext('2d');
    x.clearRect(0, 0, 256, 256);

    // Stam
    const tg = x.createLinearGradient(112, 0, 150, 0);
    tg.addColorStop(0, '#4a3220');
    tg.addColorStop(0.5, '#7a5636');
    tg.addColorStop(1, '#3a2618');
    x.fillStyle = tg;
    x.beginPath();
    x.moveTo(120, 255);
    x.bezierCurveTo(126, 190, 122, 150, 128, 120);
    x.bezierCurveTo(134, 150, 132, 190, 140, 255);
    x.closePath();
    x.fill();
    // takken
    x.strokeStyle = '#5a3d24';
    x.lineWidth = 5;
    x.beginPath(); x.moveTo(128, 150); x.lineTo(100, 120); x.stroke();
    x.beginPath(); x.moveTo(130, 140); x.lineTo(160, 110); x.stroke();

    // Kruin: overlappende gearceerde bollen
    function blob(cx, cy, r, base, hi) {
      const g = x.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
      g.addColorStop(0, hi);
      g.addColorStop(0.6, base);
      g.addColorStop(1, 'rgba(20,50,15,1)');
      x.fillStyle = g;
      x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
    }
    const greens = [
      ['#3f7a2a', '#79c24a'], ['#356b22', '#69b23e'],
      ['#2f5f1e', '#5da036'], ['#458731', '#8ad058'],
    ];
    const blobs = [
      [128, 70, 62], [90, 90, 46], [168, 88, 48], [128, 110, 52],
      [70, 70, 34], [186, 66, 34], [128, 40, 40], [104, 50, 34], [154, 52, 34],
    ];
    for (let i = 0; i < blobs.length; i++) {
      const g = greens[i % greens.length];
      blob(blobs[i][0], blobs[i][1], blobs[i][2], g[0], g[1]);
    }
    // wat blad-textuur (ruis-stippen) voor bump-detail
    for (let i = 0; i < 1400; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.random();
      const cx = 128 + Math.cos(a) * 70 * rr;
      const cy = 70 + Math.sin(a) * 55 * rr;
      const d = x.getImageData(cx | 0, cy | 0, 1, 1).data;
      if (d[3] < 10) continue;
      x.fillStyle = Math.random() > 0.5
        ? 'rgba(160,220,110,0.35)' : 'rgba(20,45,12,0.35)';
      x.fillRect(cx, cy, 2, 2);
    }
    return c;
  }

  function makeGroundCanvas() {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, '#4d7a2e');
    g.addColorStop(1, '#2c4a1c');
    x.fillStyle = g;
    x.fillRect(0, 0, 256, 64);
    for (let i = 0; i < 3000; i++) {
      const px = Math.random() * 256, py = Math.random() * 64;
      x.fillStyle = Math.random() > 0.5
        ? 'rgba(120,180,80,0.35)' : 'rgba(20,40,12,0.35)';
      x.fillRect(px, py, 2, 1);
    }
    return c;
  }

  // ---------------------------------------------------------------------------
  // Shaders
  // ---------------------------------------------------------------------------

  // Sprite (grond + boom): billboard-quad, optionele wind-sway op de vertices,
  // plus (in de FS) de FFF-324 distortion-animatie.
  const SPRITE_VS = `#version 300 es
  in vec2 a_uv;                 // (0..1), y=0 onder, y=1 boven
  uniform mat4 u_proj;
  uniform vec4 u_rect;          // x,y (linksonder), w,h  (wereld-px)
  uniform float u_time;
  uniform float u_windSpeed;
  uniform float u_windAmp;
  uniform float u_sway;         // 0 = geen wind (grond), 1 = wind (boom)
  out vec2 v_uv;
  out float v_swayFactor;
  out float v_worldX;
  void main() {
    vec2 uv = a_uv;
    float topness = uv.y;                 // 1 aan de top
    float swayFactor = topness * topness; // basis blijft staan, top buigt
    vec2 world = u_rect.xy + uv * u_rect.zw;
    v_worldX = world.x;
    if (u_sway > 0.5) {
      float w = sin(u_time * u_windSpeed + world.x * 0.008) * 0.6
              + sin(u_time * u_windSpeed * 1.9 + world.x * 0.02 + 1.7) * 0.4;
      float gust = sin(u_time * u_windSpeed * 0.3) * 0.5 + 0.5;
      world.x += w * u_windAmp * (0.4 + 0.6 * gust) * swayFactor;
    }
    v_uv = uv;
    v_swayFactor = swayFactor;
    gl_Position = u_proj * vec4(world, 0.0, 1.0);
  }`;

  // FFF-324 kern: we leiden een distortion-map (R/G) af uit de sprite en
  // gebruiken die om de UV-coordinaten in de tijd te verschuiven -> de
  // bladeren lijken te bewegen. Daarbovenop nog normal-map-belichting.
  const SPRITE_FS = `#version 300 es
  precision highp float;
  in vec2 v_uv;
  in float v_swayFactor;
  in float v_worldX;
  uniform sampler2D u_tex;
  uniform vec2 u_texel;         // 1 / textuurgrootte
  uniform vec3 u_light;         // lichtrichting (genormaliseerd buiten)
  uniform vec3 u_lightColor;
  uniform float u_ambient;
  uniform float u_bump;
  uniform float u_spec;
  uniform float u_distort;      // sterkte van de UV-distortie (FFF-324)
  uniform float u_time;
  uniform float u_windSpeed;
  uniform float u_debug;        // 0=uit, 1=normals, 2=displacement (blog-stijl)
  out vec4 outColor;
  float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  // Distortion-richting (~ R/G van de normal map) op positie uv.
  vec2 distDir(vec2 uv) {
    float hl = lum(texture(u_tex, uv - vec2(u_texel.x, 0.0)).rgb);
    float hr = lum(texture(u_tex, uv + vec2(u_texel.x, 0.0)).rgb);
    float hd = lum(texture(u_tex, uv - vec2(0.0, u_texel.y)).rgb);
    float hu = lum(texture(u_tex, uv + vec2(0.0, u_texel.y)).rgb);
    return vec2(hr - hl, hu - hd);
  }

  void main() {
    vec2 baseUv = vec2(v_uv.x, 1.0 - v_uv.y);   // textuur heeft y omgekeerd

    // 1) Wind-envelope: verandert in tijd en ruimte, sterker naar de top.
    float phase = u_time * u_windSpeed * 1.5;
    float env = sin(phase + baseUv.y * 7.0 + v_worldX * 0.02)
              * 0.6 + sin(phase * 0.53 + baseUv.x * 5.0) * 0.4;

    // 2) Distortion: verschuif de UV langs de afgeleide distortion-richting.
    vec2 dir = distDir(baseUv);
    vec2 offset = dir * u_distort * env * v_swayFactor;
    vec2 tuv = baseUv + offset;

    vec4 albedo = texture(u_tex, tuv);
    if (albedo.a < 0.25) discard;

    // 3) Normal-map-belichting op de (verschoven) positie.
    float hl = lum(texture(u_tex, tuv - vec2(u_texel.x, 0.0)).rgb);
    float hr = lum(texture(u_tex, tuv + vec2(u_texel.x, 0.0)).rgb);
    float hd = lum(texture(u_tex, tuv - vec2(0.0, u_texel.y)).rgb);
    float hu = lum(texture(u_tex, tuv + vec2(0.0, u_texel.y)).rgb);
    vec3 N = normalize(vec3((hl - hr) * u_bump, (hd - hu) * u_bump, 1.0));

    if (u_debug > 1.5) {
      // Blog-stijl: R=horizontale, G=verticale verplaatsing, B=schaal(alpha).
      outColor = vec4(offset.x * 40.0 + 0.5, offset.y * 40.0 + 0.5, albedo.a, albedo.a);
      return;
    }
    if (u_debug > 0.5) {
      outColor = vec4(N * 0.5 + 0.5, albedo.a);
      return;
    }

    vec3 L = normalize(u_light);
    float diff = max(dot(N, L), 0.0);
    float spec = pow(max(dot(N, L), 0.0), 16.0) * u_spec;
    vec3 col = albedo.rgb * (u_ambient + diff * u_lightColor) + u_lightColor * spec;
    outColor = vec4(col, albedo.a);
  }`;

  // Grassprieten: geïnstantieerde gebogen bladeren met per-blad wind + fase.
  const GRASS_VS = `#version 300 es
  in vec2 a_local;              // side(-1..1), t(0..1) langs de spriet
  in vec2 i_pos;                // basispositie (wereld-px)
  in vec4 i_data;               // hoogte, fase, buiging, kleurvariatie
  in float i_depth;             // 0 = voor, 1 = achter
  uniform mat4 u_proj;
  uniform float u_time;
  uniform float u_windSpeed;
  uniform float u_windAmp;
  out float v_t;
  out float v_side;
  out float v_colorVar;
  out float v_depth;
  out float v_slope;
  void main() {
    float t = a_local.y;
    float side = a_local.x;
    float height = i_data.x;
    float phase  = i_data.y;
    float bend   = i_data.z;

    float w = sin(u_time * u_windSpeed + phase) * 0.7
            + sin(u_time * u_windSpeed * 2.3 + phase * 1.7) * 0.3;
    float lean = (bend + w * u_windAmp) * t * t;     // top buigt het meest

    float halfW = side * (1.0 - t) * 3.0;            // taps toelopend
    vec2 world = i_pos;
    world.x += lean * height + halfW;
    world.y += t * height;

    v_t = t; v_side = side; v_colorVar = i_data.w; v_depth = i_depth;
    v_slope = lean;                                   // helling -> normal
    gl_Position = u_proj * vec4(world, 0.0, 1.0);
  }`;

  const GRASS_FS = `#version 300 es
  precision highp float;
  in float v_t;
  in float v_side;
  in float v_colorVar;
  in float v_depth;
  in float v_slope;
  uniform vec3 u_light;
  uniform vec3 u_lightColor;
  uniform float u_ambient;
  uniform float u_spec;
  uniform float u_showNormals;
  out vec4 outColor;
  void main() {
    // Ronde doorsnede (side) + helling van de spriet -> normal die meedraait
    // met de wind, zodat het licht erover glijdt.
    vec3 N = normalize(vec3(v_side * 0.9 + v_slope * 6.0, 0.15, 1.0));
    if (u_showNormals > 0.5) { outColor = vec4(N * 0.5 + 0.5, 1.0); return; }

    vec3 L = normalize(u_light);
    float diff = max(dot(N, L), 0.0);
    float spec = pow(max(dot(N, L), 0.0), 24.0) * u_spec;

    vec3 dark  = vec3(0.05, 0.22, 0.03);
    vec3 light = vec3(0.35, 0.75, 0.18);
    vec3 base  = mix(dark, light, v_t);
    base *= mix(0.6, 1.1, v_colorVar);
    base *= mix(1.0, 0.5, v_depth);                  // achterste rijen donkerder
    vec3 col = base * (u_ambient + diff * u_lightColor)
             + u_lightColor * spec * v_t;
    outColor = vec4(col, 1.0);
  }`;

  // ---------------------------------------------------------------------------
  // Scene
  // ---------------------------------------------------------------------------
  function NormalMapScene(canvas, opts) {
    opts = opts || {};
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: true });
    if (!gl) throw new Error('WebGL2 niet beschikbaar in deze browser.');
    this.canvas = canvas;
    this.gl = gl;
    this._running = false;
    this._t0 = performance.now();

    // Live-instelbare parameters (UI hangt hieraan).
    this.params = {
      windSpeed: 1.6,
      windAmp: 14,       // boom-kroon uitslag op de vertices (px)
      grassWindAmp: 0.5, // grassprieten uitslag
      distort: 0.03,     // FFF-324 UV-distortie (hoofdeffect op de bladeren)
      bump: 3.0,         // sterkte afgeleide normal map (belichting)
      ambient: 0.4,
      spec: 0.6,
      lightSpeed: 0.6,   // hoe snel het licht rondveegt
      lightManual: false,
      lightAngle: 0.0,   // handmatige lichthoek (rad)
      lightElevation: 0.55,
      debug: 0,          // 0=normaal, 1=normals, 2=displacement (blog-stijl)
      paused: false,
      grassCount: 900,
    };
    Object.assign(this.params, opts.params || {});

    this._initPrograms();
    this._initGeometry();
    this._initTextures();
    this._resize();
    window.addEventListener('resize', () => this._resize());

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  NormalMapScene.prototype._initPrograms = function () {
    const gl = this.gl;
    this.spriteP = program(gl, SPRITE_VS, SPRITE_FS);
    this.spriteU = uniforms(gl, this.spriteP);
    this.grassP = program(gl, GRASS_VS, GRASS_FS);
    this.grassU = uniforms(gl, this.grassP);
  };

  NormalMapScene.prototype._initGeometry = function () {
    const gl = this.gl;

    // Unit-quad (twee driehoeken) voor sprites.
    const quad = new Float32Array([
      0, 0, 1, 0, 1, 1,
      0, 0, 1, 1, 0, 1,
    ]);
    this.quadVAO = gl.createVertexArray();
    gl.bindVertexArray(this.quadVAO);
    const qb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    const aUv = gl.getAttribLocation(this.spriteP, 'a_uv');
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    // Grasspriet-mesh: verticale strook, opgedeeld in segmenten.
    const S = 7;
    const blade = [];
    for (let i = 0; i < S; i++) {
      const t0 = i / S, t1 = (i + 1) / S;
      blade.push(-1, t0, 1, t0, 1, t1);
      blade.push(-1, t0, 1, t1, -1, t1);
    }
    this.bladeVerts = blade.length / 2;
    this.grassVAO = gl.createVertexArray();
    gl.bindVertexArray(this.grassVAO);
    const bb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, bb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(blade), gl.STATIC_DRAW);
    const aLocal = gl.getAttribLocation(this.grassP, 'a_local');
    gl.enableVertexAttribArray(aLocal);
    gl.vertexAttribPointer(aLocal, 2, gl.FLOAT, false, 0, 0);

    // Instance-buffers (posities worden in _resize gevuld).
    this.iPosBuf = gl.createBuffer();
    this.iDataBuf = gl.createBuffer();
    this.iDepthBuf = gl.createBuffer();
    const aPos = gl.getAttribLocation(this.grassP, 'i_pos');
    const aData = gl.getAttribLocation(this.grassP, 'i_data');
    const aDepth = gl.getAttribLocation(this.grassP, 'i_depth');

    gl.bindBuffer(gl.ARRAY_BUFFER, this.iPosBuf);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(aPos, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.iDataBuf);
    gl.enableVertexAttribArray(aData);
    gl.vertexAttribPointer(aData, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(aData, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.iDepthBuf);
    gl.enableVertexAttribArray(aDepth);
    gl.vertexAttribPointer(aDepth, 1, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(aDepth, 1);

    gl.bindVertexArray(null);
  };

  NormalMapScene.prototype._buildGrass = function (W, H) {
    const n = this.params.grassCount;
    const pos = new Float32Array(n * 2);
    const data = new Float32Array(n * 4);
    const depth = new Float32Array(n);
    const bandBottom = H * 0.06;
    const bandTop = H * 0.30;
    // Sorteer achter -> voor (painter's order): grote y eerst.
    const rows = [];
    for (let i = 0; i < n; i++) rows.push(Math.random());
    rows.sort((a, b) => b - a);
    for (let i = 0; i < n; i++) {
      const r = rows[i];                       // 1 = achter, 0 = voor
      const y = bandBottom + r * (bandTop - bandBottom);
      pos[i * 2] = Math.random() * W;
      pos[i * 2 + 1] = y;
      const height = (26 + Math.random() * 34) * (1.0 - r * 0.35);
      const phase = Math.random() * Math.PI * 2;
      const bend = (Math.random() - 0.5) * 0.25;
      const colorVar = Math.random();
      data[i * 4] = height;
      data[i * 4 + 1] = phase;
      data[i * 4 + 2] = bend;
      data[i * 4 + 3] = colorVar;
      depth[i] = r;
    }
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.iPosBuf);
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.iDataBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.iDepthBuf);
    gl.bufferData(gl.ARRAY_BUFFER, depth, gl.DYNAMIC_DRAW);
    this.grassInstances = n;
  };

  NormalMapScene.prototype._makeTexture = function (source) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return { tex, w: source.width, h: source.height };
  };

  NormalMapScene.prototype._initTextures = function () {
    this.treeTex = this._makeTexture(makeTreeCanvas());
    this.groundTex = this._makeTexture(makeGroundCanvas());
    // Probeer echte assets te laden; lukt dat, dan vervangen ze de fallback.
    this._tryLoad('assets/tree.png', 'tree');
    this._tryLoad('assets/ground.png', 'ground');
  };

  NormalMapScene.prototype._tryLoad = function (url, slot) {
    const img = new Image();
    const self = this;
    img.onload = function () {
      const t = self._makeTexture(img);
      if (slot === 'tree') self.treeTex = t; else self.groundTex = t;
    };
    img.onerror = function () { /* fallback blijft staan */ };
    img.src = url;
  };

  // Publiek: eigen afbeelding inladen via <input type=file> of drag&drop.
  NormalMapScene.prototype.loadImageFromFile = function (file, slot) {
    const self = this;
    const reader = new FileReader();
    reader.onload = function (e) {
      const img = new Image();
      img.onload = function () {
        const t = self._makeTexture(img);
        if (slot === 'ground') self.groundTex = t; else self.treeTex = t;
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  };

  NormalMapScene.prototype._resize = function () {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 500;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.proj = ortho(this.canvas.width, this.canvas.height);
    this._buildGrass(this.canvas.width, this.canvas.height);
  };

  NormalMapScene.prototype._lightDir = function (time) {
    const p = this.params;
    let ang;
    if (p.lightManual) ang = p.lightAngle;
    else ang = time * p.lightSpeed;
    const e = p.lightElevation;
    // Licht draait rond in het scherm-vlak, met vaste "hoogte" (z).
    return [Math.cos(ang) * (1 - e), Math.sin(ang) * (1 - e) + 0.15, 0.5 + e * 0.5];
  };

  NormalMapScene.prototype._drawSprite = function (tex, rect, sway, time) {
    const gl = this.gl, U = this.spriteU, p = this.params;
    gl.useProgram(this.spriteP);
    gl.bindVertexArray(this.quadVAO);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex.tex);
    gl.uniform1i(U.u_tex, 0);
    gl.uniformMatrix4fv(U.u_proj, false, this.proj);
    gl.uniform4f(U.u_rect, rect[0], rect[1], rect[2], rect[3]);
    gl.uniform2f(U.u_texel, 1 / tex.w, 1 / tex.h);
    const L = this._lightDir(time);
    gl.uniform3f(U.u_light, L[0], L[1], L[2]);
    gl.uniform3f(U.u_lightColor, 1.0, 0.96, 0.85);
    gl.uniform1f(U.u_ambient, p.ambient);
    gl.uniform1f(U.u_bump, p.bump);
    gl.uniform1f(U.u_spec, p.spec);
    gl.uniform1f(U.u_distort, sway ? p.distort : 0);
    gl.uniform1f(U.u_time, time);
    gl.uniform1f(U.u_windSpeed, p.windSpeed);
    gl.uniform1f(U.u_windAmp, sway ? p.windAmp : 0);
    gl.uniform1f(U.u_sway, sway ? 1 : 0);
    gl.uniform1f(U.u_debug, p.debug);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };

  NormalMapScene.prototype._drawGrass = function (time) {
    const gl = this.gl, U = this.grassU, p = this.params;
    gl.useProgram(this.grassP);
    gl.bindVertexArray(this.grassVAO);
    gl.uniformMatrix4fv(U.u_proj, false, this.proj);
    const L = this._lightDir(time);
    gl.uniform3f(U.u_light, L[0], L[1], L[2]);
    gl.uniform3f(U.u_lightColor, 1.0, 0.96, 0.85);
    gl.uniform1f(U.u_ambient, p.ambient);
    gl.uniform1f(U.u_spec, p.spec);
    gl.uniform1f(U.u_time, time);
    gl.uniform1f(U.u_windSpeed, p.windSpeed);
    gl.uniform1f(U.u_windAmp, p.grassWindAmp);
    gl.uniform1f(U.u_showNormals, p.debug > 0.5 ? 1 : 0);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, this.bladeVerts, this.grassInstances);
  };

  NormalMapScene.prototype._frame = function () {
    if (!this._running) return;
    const gl = this.gl;
    const p = this.params;
    if (!p.paused) this._time = (performance.now() - this._t0) / 1000;
    const time = this._time || 0;
    const W = this.canvas.width, H = this.canvas.height;

    gl.clearColor(0.53, 0.70, 0.86, 1.0); // lucht
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Grondstrook onderaan.
    const groundH = H * 0.14;
    this._drawSprite(this.groundTex, [0, 0, W, groundH], false, time);

    // Boom, gecentreerd, staat op de grond.
    const th = H * 0.72;
    const tw = th * (this.treeTex.w / this.treeTex.h);
    this._drawSprite(this.treeTex, [W / 2 - tw / 2, groundH * 0.55, tw, th], true, time);

    // Grassprieten (voor de boom-basis).
    this._drawGrass(time);

    requestAnimationFrame(() => this._frame());
  };

  NormalMapScene.prototype.start = function () {
    if (this._running) return;
    this._running = true;
    this._t0 = performance.now();
    this._frame();
  };
  NormalMapScene.prototype.stop = function () { this._running = false; };

  NormalMapScene.prototype.setGrassCount = function (n) {
    this.params.grassCount = n;
    this._buildGrass(this.canvas.width, this.canvas.height);
  };

  global.NormalMapScene = NormalMapScene;
})(window);
