const canvas = document.getElementById('webglCanvas');
const gl = canvas.getContext('webgl', { antialias: true });
if (!gl) {
  alert("Twoja przeglądarka nie wspiera WebGL.");
  throw "WebGL not supported";
}
gl.enable(gl.DEPTH_TEST);
gl.enable(gl.CULL_FACE);
gl.clearColor(0, 0, 0, 1);
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  gl.viewport(0, 0, canvas.width, canvas.height);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();
function isPowerOf2(value) {
  return (value & (value - 1)) === 0;
}
function clamp(value, minVal, maxVal) {
  return Math.min(Math.max(value, minVal), maxVal);
}
const MAP_SIZE = 3000;
function loadTexture(gl, url, flipY = true) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1, 1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([255, 0, 0, 255])
  );
  const img = new Image();
  img.src = url;
  img.onload = () => {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipY);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    if (isPowerOf2(img.width) && isPowerOf2(img.height)) {
      gl.generateMipmap(gl.TEXTURE_2D);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
  };
  return tex;
}
function createWhiteTexture(gl) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const whitePixel = new Uint8Array([255, 255, 255, 255]);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1, 1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    whitePixel
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  return tex;
}
async function loadObj(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      console.error("Nie można wczytać pliku OBJ:", url);
      return null;
    }
    const text = await resp.text();
    const positions = [];
    const texcoords = [];
    const normals   = [];
    const indices   = [];
    const posArr = [];
    const texArr = [];
    const norArr = [];
    const indexMap = {};
    let idx = 0;
    const lines = text.split('\n');
    lines.forEach(line => {
      const parts = line.trim().split(/\s+/);
      if (parts[0] === 'v') {
        posArr.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
      } else if (parts[0] === 'vt') {
        texArr.push(parseFloat(parts[1]), parseFloat(parts[2]));
      } else if (parts[0] === 'vn') {
        norArr.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
      } else if (parts[0] === 'f') {
        const faceVerts = parts.slice(1);
        faceVerts.forEach(part => {
          const [vIdx, vtIdx, vnIdx] = part.split('/').map(i => parseInt(i) - 1);
          const key = `${vIdx}/${vtIdx}/${vnIdx}`;
          if (!(key in indexMap)) {
            positions.push(posArr[3*vIdx], posArr[3*vIdx+1], posArr[3*vIdx+2]);
            if (vtIdx >= 0) {
              texcoords.push(texArr[2*vtIdx], 1.0 - texArr[2*vtIdx+1]);
            } else {
              texcoords.push(0, 0);
            }
            if (vnIdx >= 0) {
              normals.push(norArr[3*vnIdx], norArr[3*vnIdx+1], norArr[3*vnIdx+2]);
            } else {
              normals.push(0, 1, 0);
            }
            indexMap[key] = idx++;
          }
          indices.push(indexMap[key]);
        });
      }
    });
    return {
      positions: new Float32Array(positions),
      texcoords: new Float32Array(texcoords),
      normals:   new Float32Array(normals),
      indices:   new Uint16Array(indices)
    };
  } catch (err) {
    console.error("Błąd w loadObj:", err);
    return null;
  }
}
function compileShader(type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error("Shader compile error:", gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}
function createProgram(vsSrc, fsSrc) {
  const vs = compileShader(gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl.FRAGMENT_SHADER, fsSrc);
  const pr = gl.createProgram();
  gl.attachShader(pr, vs);
  gl.attachShader(pr, fs);
  gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) {
    console.error("Link error:", gl.getProgramInfoLog(pr));
    gl.deleteProgram(pr);
    return null;
  }
  return pr;
}
let keys = new Array(128).fill(false);
window.addEventListener('keydown', (ev) => {
  const code = ev.keyCode;
  if (code < 128) keys[code] = true;
});
window.addEventListener('keyup', (ev) => {
  const code = ev.keyCode;
  if (code < 128) keys[code] = false;
});
function handleKeyboard() {
  if (keys[87]) { if (player) player.moveForward(); }
  if (keys[83]) { if (player) player.moveBackward(); }
  if (keys[65]) { if (player) player.rotateLeft(); }
  if (keys[68]) { if (player) player.rotateRight(); }
}
const skyboxVS = `
  attribute vec3 aPosition;
  varying vec3 vTexCoord;
  uniform mat4 uViewMatrix;
  uniform mat4 uProjectionMatrix;
  void main(){
    vTexCoord = aPosition;
    gl_Position = uProjectionMatrix * uViewMatrix * vec4(aPosition, 1.0);
    gl_Position = gl_Position.xyww;
  }
`;
const skyboxFS = `
  precision mediump float;
  varying vec3 vTexCoord;
  uniform samplerCube uSkybox;
  void main(){
    gl_FragColor = textureCube(uSkybox, vTexCoord);
  }
`;
const skyboxProg = createProgram(skyboxVS, skyboxFS);
const sbPosLoc   = gl.getAttribLocation(skyboxProg, "aPosition");
const sbViewLoc  = gl.getUniformLocation(skyboxProg, "uViewMatrix");
const sbProjLoc  = gl.getUniformLocation(skyboxProg, "uProjectionMatrix");
const sbSamplerLoc = gl.getUniformLocation(skyboxProg, "uSkybox");
const skyboxVertices = new Float32Array([
  -1,  1, -1,   -1, -1, -1,    1, -1, -1,
   1, -1, -1,    1,  1, -1,   -1,  1, -1,
  -1, -1,  1,   -1, -1, -1,   -1,  1, -1,
  -1,  1, -1,   -1,  1,  1,   -1, -1,  1,
   1, -1, -1,    1, -1,  1,    1,  1,  1,
   1,  1,  1,    1,  1, -1,    1, -1, -1,
  -1, -1,  1,   -1,  1,  1,    1,  1,  1,
   1,  1,  1,    1, -1,  1,   -1, -1,  1,
  -1,  1, -1,    1,  1, -1,    1,  1,  1,
   1,  1,  1,   -1,  1,  1,   -1,  1, -1,
  -1, -1, -1,   -1, -1,  1,    1, -1, -1,
   1, -1, -1,   -1, -1,  1,    1, -1,  1
]);
const skyboxBuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, skyboxBuf);
gl.bufferData(gl.ARRAY_BUFFER, skyboxVertices, gl.STATIC_DRAW);
const skyboxTex = (function(){
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, t);
  const faces = [
    { target: gl.TEXTURE_CUBE_MAP_POSITIVE_X, url: 'skybox/posx.png' },
    { target: gl.TEXTURE_CUBE_MAP_NEGATIVE_X, url: 'skybox/negx.png' },
    { target: gl.TEXTURE_CUBE_MAP_POSITIVE_Y, url: 'skybox/posy.png' },
    { target: gl.TEXTURE_CUBE_MAP_NEGATIVE_Y, url: 'skybox/negy.png' },
    { target: gl.TEXTURE_CUBE_MAP_POSITIVE_Z, url: 'skybox/posz.png' },
    { target: gl.TEXTURE_CUBE_MAP_NEGATIVE_Z, url: 'skybox/negz.png' }
  ];
  for (let i = 0; i < faces.length; i++) {
    gl.texImage2D(
      faces[i].target, 0,
      gl.RGBA, 1, 1, 0,
      gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([0,0,255,255])
    );
  }
  faces.forEach(face => {
    const img = new Image();
    img.onload = () => {
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, t);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(face.target, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
    };
    img.src = face.url;
  });
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return t;
})();
function renderSkybox(viewMatrix, projMatrix) {
  gl.useProgram(skyboxProg);
  const viewNoTrans = mat4.clone(viewMatrix);
  viewNoTrans[12] = 0;
  viewNoTrans[13] = 0;
  viewNoTrans[14] = 0;
  gl.uniformMatrix4fv(sbViewLoc, false, viewNoTrans);
  gl.uniformMatrix4fv(sbProjLoc, false, projMatrix);
  gl.bindBuffer(gl.ARRAY_BUFFER, skyboxBuf);
  gl.vertexAttribPointer(sbPosLoc, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(sbPosLoc);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, skyboxTex);
  gl.uniform1i(sbSamplerLoc, 0);
  gl.depthMask(false);
  gl.depthFunc(gl.LEQUAL);
  gl.disable(gl.CULL_FACE);
  gl.drawArrays(gl.TRIANGLES, 0, 36);
  gl.enable(gl.CULL_FACE);
  gl.depthFunc(gl.LESS);
  gl.depthMask(true);
}
const objectVS = `
  attribute vec3 a_position;
  attribute vec2 a_texcoord;
  attribute vec3 a_normal;
  uniform mat4 u_matrix;
  uniform mat3 u_normalMatrix;
  uniform vec3 u_lightDirection;
  varying vec2 v_texcoord;
  varying float v_light;
  void main(){
    gl_Position = u_matrix * vec4(a_position, 1.0);
    v_texcoord  = a_texcoord;
    vec3 n = normalize(u_normalMatrix * a_normal);
    float df = max(dot(n, -u_lightDirection), 0.0);
    v_light = 0.2 + 0.6*df;
  }
`;
const objectFS = `
  precision mediump float;
  varying vec2 v_texcoord;
  varying float v_light;
  uniform sampler2D u_texture;
  uniform vec3 u_objectColor;
  uniform float u_collisionState;
  void main(){
    vec4 texColor = texture2D(u_texture, v_texcoord);
    if (u_collisionState > 0.5) {
      gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
    } else {
      gl_FragColor = vec4(texColor.rgb * v_light * u_objectColor, texColor.a);
    }
  }
`;
const objectProg = createProgram(objectVS, objectFS);
const loc_aPos   = gl.getAttribLocation(objectProg, "a_position");
const loc_aTex   = gl.getAttribLocation(objectProg, "a_texcoord");
const loc_aNor   = gl.getAttribLocation(objectProg, "a_normal");
const loc_uMtx   = gl.getUniformLocation(objectProg, "u_matrix");
const loc_uNorm  = gl.getUniformLocation(objectProg, "u_normalMatrix");
const loc_uTex   = gl.getUniformLocation(objectProg, "u_texture");
const loc_uLight = gl.getUniformLocation(objectProg, "u_lightDirection");
const loc_uColor = gl.getUniformLocation(objectProg, "u_objectColor");
const loc_uColl  = gl.getUniformLocation(objectProg, "u_collisionState");
function createBuffers(gl, data) {
  const { positions, texcoords, normals, indices } = data;
  const posB = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, posB);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
  const texB = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, texB);
  gl.bufferData(gl.ARRAY_BUFFER, texcoords, gl.STATIC_DRAW);
  const norB = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, norB);
  gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);
  const idxB = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxB);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  return {
    positionBuffer: posB,
    texcoordBuffer: texB,
    normalBuffer:   norB,
    indexBuffer:    idxB,
    indexCount:     indices.length
  };
}
function renderObjectGeneric(buffers, texture, color3f, modelMtx, viewMtx, projMtx, isColliding = false) {
  gl.useProgram(objectProg);
  const mv = mat4.create();
  mat4.multiply(mv, viewMtx, modelMtx);
  const nm = mat3.create();
  mat3.normalFromMat4(nm, mv);
  const mvp = mat4.create();
  mat4.multiply(mvp, projMtx, mv);
  gl.uniformMatrix4fv(loc_uMtx,  false, mvp);
  gl.uniformMatrix3fv(loc_uNorm, false, nm);
  gl.uniform3f(loc_uLight, 0, -1, -1);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.uniform1i(loc_uTex, 0);
  gl.uniform3fv(loc_uColor, color3f);
  gl.uniform1f(loc_uColl, isColliding ? 1.0 : 0.0);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.positionBuffer);
  gl.vertexAttribPointer(loc_aPos, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(loc_aPos);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.texcoordBuffer);
  gl.vertexAttribPointer(loc_aTex, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(loc_aTex);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.normalBuffer);
  gl.vertexAttribPointer(loc_aNor, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(loc_aNor);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.indexBuffer);
  gl.drawElements(gl.TRIANGLES, buffers.indexCount, gl.UNSIGNED_SHORT, 0);
}
function renderObject(buffers, texture, modelMtx, viewMtx, projMtx, isColliding = false) {
  renderObjectGeneric(buffers, texture, [1, 1, 1], modelMtx, viewMtx, projMtx, isColliding);
}
function renderObjectColor(buffers, color3f, modelMtx, viewMtx, projMtx, isColliding = false) {
  renderObjectGeneric(buffers, whiteTex, color3f, modelMtx, viewMtx, projMtx, isColliding);
}
class Ground {
  constructor() {
    this.triangles = [];
  }
  initFromObjData(positions, indices) {
    for (let i = 0; i < indices.length; i += 3) {
      const i1 = indices[i], i2 = indices[i+1], i3 = indices[i+2];
      const p1 = [ positions[3*i1], positions[3*i1+1], positions[3*i1+2] ];
      const p2 = [ positions[3*i2], positions[3*i2+1], positions[3*i2+2] ];
      const p3 = [ positions[3*i3], positions[3*i3+1], positions[3*i3+2] ];
      this.triangles.push(this.createTriangle(p1, p2, p3));
    }
  }
  createTriangle(p1, p2, p3) {
    const v1 = [p2[0]-p1[0], p2[1]-p1[1], p2[2]-p1[2]];
    const v2 = [p3[0]-p1[0], p3[1]-p1[1], p3[2]-p1[2]];
    const n  = cross(v1, v2);
    const [A, B, C] = n;
    const D = -(A*p1[0] + B*p1[1] + C*p1[2]);
    return { p1, p2, p3, A, B, C, D };
  }
  getAltitude(x, z) {
    for (let tri of this.triangles) {
      if (this.isInsideXZ([x,z], tri)) {
        const y = this.solveY(x, z, tri);
        if (y !== null) return y;
      }
    }
    return null;
  }
  isInsideXZ(p, tri) {
    const px = p[0], pz = p[1];
    const x1 = tri.p1[0], z1 = tri.p1[2];
    const x2 = tri.p2[0], z2 = tri.p2[2];
    const x3 = tri.p3[0], z3 = tri.p3[2];
    const areaOrig = triArea(x1, z1, x2, z2, x3, z3);
    const a1 = triArea(px, pz, x2, z2, x3, z3);
    const a2 = triArea(x1, z1, px, pz, x3, z3);
    const a3 = triArea(x1, z1, x2, z2, px, pz);
    if (Math.abs(a1 + a2 + a3 - areaOrig) > 1e-5) return false;
    return true;
  }
  solveY(x, z, tri) {
    const { A, B, C, D } = tri;
    if (Math.abs(B) < 1e-9) return null;
    return -(A*x + C*z + D) / B;
  }
}
function triArea(x1, y1, x2, y2, x3, y3) {
  return Math.abs(x1*(y2-y3) + x2*(y3-y1) + x3*(y1-y2)) / 2;
}
function cross(a, b) {
  return [
    a[1]*b[2] - a[2]*b[1],
    a[2]*b[0] - a[0]*b[2],
    a[0]*b[1] - a[1]*b[0]
  ];
}
let score = 0;
function updateScoreOnScreen() {
  const sb = document.getElementById('scoreBoard');
  if (sb) {
    sb.textContent = "Your score: " + score;
  }
}
class Player {
  constructor(ground) {
    this.ground = ground;
    this.pos    = [0, 0, 0];
    this.userAngle = 4.7;
    this.angleNow  = 4.7;
    this.dir       = [0, 0, 0];
    this.swimTime  = 0.0;
    this.mesh    = null;
    this.texture = null;
    this.scale   = 20;
    this.offsetY = 40;
    this.radius  = 30;
    this.updateDirWithAngle(this.userAngle);
  }
  async initModel(objUrl, texUrl) {
    const data = await loadObj(objUrl);
    if (!data) return;
    this.mesh    = createBuffers(gl, data);
    this.texture = loadTexture(gl, texUrl, true);
  }
  rotateLeft()  { this.userAngle += 0.02; }
  rotateRight() { this.userAngle -= 0.02; }
  updateDirWithAngle(a) {
    let a2 = a + Math.PI * 0.5;
    this.dir[0] = -Math.sin(a2);
    this.dir[1] =  0;
    this.dir[2] = -Math.cos(a2);
  }
  setPosition(x, z) {
    const y = this.ground.getAltitude(x, z);
    if (y !== null) {
      this.pos[0] = x;
      this.pos[1] = y;
      this.pos[2] = z;
    }
  }
  collidesWithGold(nx, ny, nz) {
    let collided = false;
    for (let go of goldObjects) {
      go.isColliding = false;
    }
    for (let go of goldObjects) {
      const dx = go.pos[0] - nx;
      const dy = go.pos[1] - ny;
      const dz = go.pos[2] - nz;
      const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
      if (dist < (this.radius + go.radius)) {
        go.isColliding = true;
        collided = true;
      }
    }
    return collided;
  }
  collidesWithFishes(nx, ny, nz) {
    for (let i = 0; i < fishes.length; i++) {
      let f = fishes[i];
      const dx = f.pos[0] - nx;
      const dy = f.pos[1] - ny;
      const dz = f.pos[2] - nz;
      const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
      if (dist < (this.radius + f.radius) * 0.4) {
        fishes.splice(i, 1);
        i--;
        score++;
        updateScoreOnScreen();
      }
    }
  }
  collidesWithJellyfishs(nx, ny, nz) {
    for (let i = 0; i < jellyfishs.length; i++) {
      let s = jellyfishs[i];
      const dx = s.pos[0] - nx;
      const dy = s.pos[1] - ny;
      const dz = s.pos[2] - nz;
      if (Math.sqrt(dx*dx + dy*dy + dz*dz) < (this.radius + 10)) {
        jellyfishs.splice(i, 1);
        i--;
        score++;
        updateScoreOnScreen();
      }
    }
  }
  moveForward() {
    const step = 4;
    let nx = this.pos[0] + this.dir[0] * step;
    let nz = this.pos[2] + this.dir[2] * step;
    nx = clamp(nx, -MAP_SIZE, MAP_SIZE);
    nz = clamp(nz, -MAP_SIZE, MAP_SIZE);
    const ny = this.ground.getAltitude(nx, nz);
    if (ny === null) return;
    const dy = ny - this.pos[1];
    if (Math.abs(dy) > 5.0) return;
    if (this.collidesWithGold(nx, ny + this.offsetY, nz)) {
      return;
    }
    this.collidesWithFishes(nx, ny + this.offsetY, nz);
    this.collidesWithJellyfishs(nx, ny + this.offsetY, nz);
    this.pos[0] = nx;
    this.pos[1] = ny;
    this.pos[2] = nz;
  }
  moveBackward() {
    const step = 4;
    let nx = this.pos[0] - this.dir[0] * step;
    let nz = this.pos[2] - this.dir[2] * step;
    nx = clamp(nx, -MAP_SIZE, MAP_SIZE);
    nz = clamp(nz, -MAP_SIZE, MAP_SIZE);
    const ny = this.ground.getAltitude(nx, nz);
    if (ny === null) return;
    const dy = ny - this.pos[1];
    if (Math.abs(dy) > 1.0) return;
    if (this.collidesWithGold(nx, ny + this.offsetY, nz)) {
      return;
    }
    this.collidesWithFishes(nx, ny + this.offsetY, nz);
    this.collidesWithJellyfishs(nx, ny + this.offsetY, nz);
    this.pos[0] = nx;
    this.pos[1] = ny;
    this.pos[2] = nz;
  }
  update(dt) {
    this.swimTime += dt;
    const waveAmp  = 0.05;
    const waveFreq = 0.003;
    const wave = waveAmp * Math.sin(this.swimTime * waveFreq);
    this.angleNow = this.userAngle + wave;
    this.updateDirWithAngle(this.angleNow);
  }
  render(viewMatrix, projMatrix) {
    if (!this.mesh || !this.texture) return;
    const modelMtx = mat4.create();
    mat4.translate(modelMtx, modelMtx, [
      this.pos[0],
      this.pos[1] + this.offsetY,
      this.pos[2]
    ]);
    mat4.rotateY(modelMtx, modelMtx, this.angleNow);
    mat4.scale(modelMtx, modelMtx, [this.scale, this.scale, this.scale]);
    renderObject(this.mesh, this.texture, modelMtx, viewMatrix, projMatrix);
  }
}
class Coral {
  constructor(x, y, z, scale, color3f, mesh) {
    this.pos   = [x, y, z];
    this.scale = scale;
    this.color = color3f;
    this.mesh  = mesh;
    this.angleY= Math.random() * Math.PI * 2;
  }
  render(viewMtx, projMtx) {
    if (!this.mesh) return;
    const modelMtx = mat4.create();
    mat4.translate(modelMtx, modelMtx, this.pos);
    mat4.rotateY(modelMtx, modelMtx, this.angleY);
    mat4.scale(modelMtx, modelMtx, [this.scale, this.scale, this.scale]);
    renderObjectColor(this.mesh, this.color, modelMtx, viewMtx, projMtx);
  }
}
class Octopus {
  constructor(mesh, x, y, z, scale, color) {
    this.mesh = mesh;
    this.pos = [x, y, z];
    this.scale = scale;
    this.color = color;
    this.angleY = Math.random() * 2 * Math.PI;
  }
  render(viewMatrix, projMatrix) {
    if (!this.mesh) return;
    const modelMtx = mat4.create();
    mat4.translate(modelMtx, modelMtx, this.pos);
    mat4.rotateY(modelMtx, modelMtx, this.angleY);
    mat4.scale(modelMtx, modelMtx, [this.scale, this.scale, this.scale]);
    renderObjectColor(this.mesh, this.color, modelMtx, viewMatrix, projMatrix);
  }
}
class Jellyfish {
  constructor(mesh, x, y, z, scale, color) {
    this.mesh = mesh;
    this.pos = [x, y, z];
    this.baseY = y;
    this.scale = scale;
    this.color = color;
    this.angleY = Math.random() * 2 * Math.PI;
    this.timeOffset = Math.random() * 1000;
  }
  update(dt) {
    let t = performance.now() * 0.001 + this.timeOffset;
    let offset = Math.sin(t * 2) * 5;
    this.pos[1] = this.baseY + offset;
  }
  render(viewMatrix, projMatrix) {
    if (!this.mesh) return;
    const modelMtx = mat4.create();
    mat4.translate(modelMtx, modelMtx, this.pos);
    mat4.rotateY(modelMtx, modelMtx, this.angleY);
    mat4.scale(modelMtx, modelMtx, [this.scale, this.scale, this.scale]);
    renderObjectColor(this.mesh, this.color, modelMtx, viewMatrix, projMatrix);
  }
}
class SeaweedPair {
  constructor(x, y, z, scale) {
    this.pos = [x, y, z];
    this.scale = scale;
    this.angle = Math.random() * 2 * Math.PI;
  }
  render(viewMatrix, projMatrix) {
    gl.enable(gl.BLEND);
    gl.depthMask(false);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const modelMtx1 = mat4.create();
    mat4.translate(modelMtx1, modelMtx1, this.pos);
    mat4.rotateY(modelMtx1, modelMtx1, this.angle);
    mat4.scale(modelMtx1, modelMtx1, [this.scale, this.scale, this.scale]);
    renderObjectGeneric(seaweedMesh, seaweedTexture, [1, 1, 1], modelMtx1, viewMatrix, projMatrix);
    const modelMtx2 = mat4.create();
    mat4.translate(modelMtx2, modelMtx2, this.pos);
    mat4.rotateY(modelMtx2, modelMtx2, this.angle + Math.PI / 2);
    mat4.scale(modelMtx2, modelMtx2, [this.scale, this.scale, this.scale]);
    renderObjectGeneric(seaweedMesh, seaweedTexture, [1, 1, 1], modelMtx2, viewMatrix, projMatrix);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }
}
function createSeaweedMesh() {
  const positions = new Float32Array([
    -0.5, -0.5, 0,
     0.5, -0.5, 0,
     0.5,  0.5, 0,
    -0.5,  0.5, 0
  ]);
  const texcoords = new Float32Array([
    0, 1,
    1, 1,
    1, 0,
    0, 0
  ]);
  const normals = new Float32Array([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
    0, 0, 1
  ]);
  const indices = new Uint16Array([0, 1, 2, 2, 3, 0]);
  const posB = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, posB);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
  const texB = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, texB);
  gl.bufferData(gl.ARRAY_BUFFER, texcoords, gl.STATIC_DRAW);
  const norB = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, norB);
  gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);
  const idxB = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxB);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  return {
    positionBuffer: posB,
    texcoordBuffer: texB,
    normalBuffer: norB,
    indexBuffer: idxB,
    indexCount: indices.length
  };
}
class Turtle {
  constructor(mesh, x, y, z, scale, color) {
    this.mesh = mesh;
    this.pos = [x, y, z];
    this.scale = scale;
    this.color = color;
    this.angleY = Math.random() * 2 * Math.PI;
  }
  render(viewMatrix, projMatrix) {
    if (!this.mesh) return;
    const modelMtx = mat4.create();
    mat4.translate(modelMtx, modelMtx, this.pos);
    mat4.rotateY(modelMtx, modelMtx, this.angleY);
    mat4.scale(modelMtx, modelMtx, [this.scale, this.scale, this.scale]);
    renderObjectColor(this.mesh, this.color, modelMtx, viewMatrix, projMatrix);
  }
}
class GoldObject {
  constructor(mesh, x, y, z, scale) {
    this.mesh  = mesh;
    this.pos   = [x, y, z];
    this.scale = scale;
    this.angleY= Math.random() * Math.PI * 2;
    this.angleX= 3 * Math.PI / 2;
    this.radius= scale * 5;
    this.isColliding = false;
  }
  render(tex, viewMatrix, projMatrix) {
    if (!this.mesh) return;
    const modelMtx = mat4.create();
    mat4.translate(modelMtx, modelMtx, this.pos);
    mat4.rotateY(modelMtx, modelMtx, this.angleY);
    mat4.rotateX(modelMtx, modelMtx, this.angleX);
    mat4.scale(modelMtx, modelMtx, [this.scale, this.scale, this.scale]);
    renderObject(this.mesh, tex, modelMtx, viewMatrix, projMatrix, this.isColliding);
  }
}
class Fish {
  constructor(mesh, color3f, x, z, scale = 1) {
    this.mesh   = mesh;
    this.color  = color3f;
    this.pos    = [x, 0, z];
    this.scale  = scale;
    this.radius = this.scale * 2;
    this.offsetY = 30;
    this.speed   = 0.3 + Math.random() * 0.1;
    const angle  = Math.random() * 2 * Math.PI;
    this.dx      = Math.cos(angle) * this.speed;
    this.dz      = Math.sin(angle) * this.speed;
    this.angleY  = angle;
    this.targetAngle = angle;
  }
  update(dt) {
    const sharkDx = player.pos[0] - this.pos[0];
    const sharkDz = player.pos[2] - this.pos[2];
    const distSq  = sharkDx*sharkDx + sharkDz*sharkDz;
    const avoidRadius = 200 * 200;
    if (distSq < avoidRadius) {
      let angleToShark = Math.atan2(sharkDz, sharkDx);
      this.targetAngle = angleToShark + Math.PI * 0.5;
    }
    let angleDiff = this.targetAngle - this.angleY;
    if (angleDiff > Math.PI)  angleDiff -= 2 * Math.PI;
    if (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
    const turnSpeed = 0.05;
    this.angleY += angleDiff * turnSpeed;
    this.dx = Math.cos(this.angleY) * this.speed;
    this.dz = Math.sin(this.angleY) * this.speed;
    let moveStep = this.speed * dt * 0.2;
    let newX = this.pos[0] + this.dx * moveStep;
    let newZ = this.pos[2] + this.dz * moveStep;
    let bounced = false;
    if(newX > MAP_SIZE) {
      newX = MAP_SIZE;
      bounced = true;
    } else if(newX < -MAP_SIZE) {
      newX = -MAP_SIZE;
      bounced = true;
    }
    if(newZ > MAP_SIZE) {
      newZ = MAP_SIZE;
      bounced = true;
    } else if(newZ < -MAP_SIZE) {
      newZ = -MAP_SIZE;
      bounced = true;
    }
    if(bounced) {
      this.targetAngle = this.angleY + Math.PI;
    }
    const groundY = ground.getAltitude(newX, newZ);
    if (groundY !== null) {
      this.pos[0] = newX;
      this.pos[2] = newZ;
      this.pos[1] = groundY + this.offsetY;
    }
  }
  render(viewMatrix, projMatrix) {
    if (!this.mesh) return;
    const modelMtx = mat4.create();
    mat4.translate(modelMtx, modelMtx, this.pos);
    mat4.rotateY(modelMtx, modelMtx, this.angleY);
    mat4.scale(modelMtx, modelMtx, [this.scale, this.scale, this.scale]);
    renderObjectColor(this.mesh, this.color, modelMtx, viewMatrix, projMatrix);
  }
}
let bubbleTexture = null;
let bubbleMesh    = null;
let bubbles       = [];
const NUM_BUBBLES = 5000;
function createBubbleMesh() {
  const bubbleQuadPositions = new Float32Array([
    -0.5, -0.5, 0.0,
     0.5, -0.5, 0.0,
     0.5,  0.5, 0.0,
    -0.5,  0.5, 0.0
  ]);
  const bubbleQuadTexcoords = new Float32Array([
    0.0, 1.0,
    1.0, 1.0,
    1.0, 0.0,
    0.0, 0.0
  ]);
  const bubbleQuadIndices = new Uint16Array([0,1,2, 2,3,0]);
  let posB = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, posB);
  gl.bufferData(gl.ARRAY_BUFFER, bubbleQuadPositions, gl.STATIC_DRAW);
  let texB = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, texB);
  gl.bufferData(gl.ARRAY_BUFFER, bubbleQuadTexcoords, gl.STATIC_DRAW);
  let idxB = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxB);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, bubbleQuadIndices, gl.STATIC_DRAW);
  return {
    positionBuffer: posB,
    texcoordBuffer: texB,
    normalBuffer:   null,
    indexBuffer: idxB,
    indexCount: bubbleQuadIndices.length
  };
}
const bubbleVS = `
  attribute vec3 a_position;
  attribute vec2 a_texcoord;
  uniform mat4 u_viewMatrix;
  uniform mat4 u_projMatrix;
  uniform vec3  u_pos;
  uniform float u_scale;
  varying vec2 v_texcoord;
  void main(){
    vec4 posLocal = vec4(a_position * u_scale, 1.0);
    posLocal.xyz += u_pos;
    vec4 posView = u_viewMatrix * posLocal;
    gl_Position  = u_projMatrix * posView;
    v_texcoord   = a_texcoord;
  }
`;
const bubbleFS = `
  precision mediump float;
  varying vec2 v_texcoord;
  uniform sampler2D u_texture;
  void main(){
    vec4 color = texture2D(u_texture, v_texcoord);
    if (color.a < 0.1) discard;
    gl_FragColor = color;
  }
`;
const bubbleProg = createProgram(bubbleVS, bubbleFS);
const bubble_aPos = gl.getAttribLocation(bubbleProg, "a_position");
const bubble_aTex = gl.getAttribLocation(bubbleProg, "a_texcoord");
const bubble_uView  = gl.getUniformLocation(bubbleProg, "u_viewMatrix");
const bubble_uProj  = gl.getUniformLocation(bubbleProg, "u_projMatrix");
const bubble_uPos   = gl.getUniformLocation(bubbleProg, "u_pos");
const bubble_uScale = gl.getUniformLocation(bubbleProg, "u_scale");
const bubble_uTex   = gl.getUniformLocation(bubbleProg, "u_texture");
class Bubble {
  constructor() {
    this.x = (Math.random() - 0.5) * (MAP_SIZE * 2);
    this.z = (Math.random() - 0.5) * (MAP_SIZE * 2);
    this.y = -50 - Math.random() * 50;
    this.speed = 0.03 + Math.random() * 0.03;
    this.amplitude = 3 + Math.random() * 2;
    this.freq      = 0.5 + Math.random();
    this.phase     = Math.random() * 10.0;
    this.scale = 1 + Math.random() * 2;
    this.baseX = this.x;
  }
  update(dt) {
    this.y += this.speed * dt * 0.1;
    let time = performance.now() * 0.001;
    this.x = this.baseX + this.amplitude * Math.sin(time * this.freq + this.phase);
    if (this.y > 60) {
      this.y = -50 - Math.random() * 50;
      this.baseX = (Math.random() - 0.5) * (MAP_SIZE * 2);
      this.x = this.baseX;
      this.z = (Math.random() - 0.5) * (MAP_SIZE * 2);
    }
  }
}
function updateBubbles(dt) {
  for (let i = 0; i < bubbles.length; i++) {
    bubbles[i].update(dt);
  }
}
function renderBubbles(viewMatrix, projMatrix) {
  gl.useProgram(bubbleProg);
  gl.uniformMatrix4fv(bubble_uView, false, viewMatrix);
  gl.uniformMatrix4fv(bubble_uProj, false, projMatrix);
  gl.bindBuffer(gl.ARRAY_BUFFER, bubbleMesh.positionBuffer);
  gl.vertexAttribPointer(bubble_aPos, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(bubble_aPos);
  gl.bindBuffer(gl.ARRAY_BUFFER, bubbleMesh.texcoordBuffer);
  gl.vertexAttribPointer(bubble_aTex, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(bubble_aTex);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bubbleMesh.indexBuffer);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, bubbleTexture);
  gl.uniform1i(bubble_uTex, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  for (let i = 0; i < bubbles.length; i++) {
    const b = bubbles[i];
    gl.uniform3f(bubble_uPos, b.x, b.y, b.z);
    gl.uniform1f(bubble_uScale, b.scale);
    gl.drawElements(gl.TRIANGLES, bubbleMesh.indexCount, gl.UNSIGNED_SHORT, 0);
  }
  gl.disable(gl.BLEND);
}
let ground = new Ground();
let groundBuffers = null;
let groundTexture = null;
let player = null;
let coralMesh = null;
let corals = [];
let whiteTex = null;
let goldTex = null;
let chestMesh = null;
let diverMesh = null;
let goldObjects = [];
let fishMeshes = [];
let fishes = [];
const FISH_COUNT = 200;
let octopuses = [];
let octopusMesh = null;
let jellyfishs = [];
let jellyfishMesh = null;
let seaweedPairs = [];
let seaweedMesh = null;
let seaweedTexture = null;
let turtles = [];
let turtleMesh = null;
let gameState = "menu";
const GAME_DURATION = 60;
let remainingTime = GAME_DURATION;
document.getElementById("startButton").addEventListener("click", function() {
  gameState = "playing";
  remainingTime = GAME_DURATION;
  score = 0;
  updateScoreOnScreen();
  document.getElementById("overlay").style.display = "none";
  document.getElementById("fpsMeter").style.display = "block";
});
(async function init() {
  whiteTex = createWhiteTexture(gl);
  let terrainData = await loadObj('objects/terrain.obj');
  if (!terrainData) {
    console.log("Brak modelu terenu. Przerywam init.");
    return;
  }
  for (let i = 0; i < terrainData.positions.length; i += 3) {
    terrainData.positions[i+0] *= 50;
    terrainData.positions[i+1] *= 15;
    terrainData.positions[i+1] -= 100;
    terrainData.positions[i+2] *= 50;
    terrainData.positions[i+2] -= 50;
  }
  groundBuffers = createBuffers(gl, terrainData);
  groundTexture = loadTexture(gl, 'textures/terrain.jpg');
  ground.initFromObjData(terrainData.positions, terrainData.indices);
  player = new Player(ground);
  await player.initModel('objects/shark.obj', 'textures/shark.png');
  player.setPosition(0, -300);
  let coralData = await loadObj('objects/coral.obj');
  if (coralData) {
    coralMesh = createBuffers(gl, coralData);
  }
  const coralColors = [
    [0.56, 0.09, 0.09],
    [0.74, 0.36, 0.02],
    [0.92, 0.71, 0.02],
    [0.34, 0.55, 0.02],
    [0.02, 0.55, 0.40],
    [0.02, 0.47, 0.55],
    [0.25, 0.13, 0.46],
    [0.44, 0.13, 0.46],
    [0.64, 0.16, 0.53]
  ];
  for (let i = 0; i < 1000; i++) {
    if (!coralMesh) break;
    let x = Math.random() * (MAP_SIZE * 2) - MAP_SIZE;
    let z = Math.random() * (MAP_SIZE * 2) - MAP_SIZE;
    let y = ground.getAltitude(x, z);
    if (y === null) continue;
    let scale = 1 + Math.random() * 2;
    let color = coralColors[Math.floor(Math.random() * coralColors.length)];
    corals.push(new Coral(x, y, z, scale, color, coralMesh));
  }
  goldTex = loadTexture(gl, 'textures/gold.jpg');
  let chestData = await loadObj('objects/chest.obj');
  let diverData = await loadObj('objects/diver.obj');
  if (chestData) chestMesh = createBuffers(gl, chestData);
  if (diverData) diverMesh = createBuffers(gl, diverData);
  function spawnGoldObjects(mesh, count = 30) {
    for (let i = 0; i < count; i++) {
      const x = Math.random() * (MAP_SIZE * 2) - MAP_SIZE;
      const z = Math.random() * (MAP_SIZE * 2) - MAP_SIZE;
      const y = ground.getAltitude(x, z);
      if (y === null) continue;
      const scale = 2 + Math.random() * 3;
      goldObjects.push(new GoldObject(mesh, x, y, z, scale));
    }
  }
  if (chestMesh) spawnGoldObjects(chestMesh, 5);
  if (diverMesh) spawnGoldObjects(diverMesh, 5);
  for (let i = 1; i <= 5; i++) {
    let fData = await loadObj(`objects/fish${i}.obj`);
    if (fData) fishMeshes.push(createBuffers(gl, fData));
  }
  const fishColors = [
    [0.84, 0.35, 0.08],
    [0.07, 0.62, 0.72],
    [0.87, 0.32, 0.66],
    [0.81, 0.24, 0.24],
    [0.22, 0.64, 0.22],
    [0.65, 0.36, 0.95]
  ];
  if (fishMeshes.length > 0) {
    for (let i = 0; i < FISH_COUNT; i++) {
      const meshIndex = Math.floor(Math.random() * fishMeshes.length);
      const mesh = fishMeshes[meshIndex];
      let x = Math.random() * (MAP_SIZE * 2) - MAP_SIZE;
      let z = Math.random() * (MAP_SIZE * 2) - MAP_SIZE;
      const scale = 5 + Math.random() * 5;
      const color = fishColors[Math.floor(Math.random() * fishColors.length)];
      fishes.push(new Fish(mesh, color, x, z, scale));
    }
  }
  bubbleTexture = loadTexture(gl, 'images/bubble.png', true);
  bubbleMesh = createBubbleMesh();
  for (let i = 0; i < NUM_BUBBLES; i++) {
    bubbles.push(new Bubble());
  }
  octopusMesh = await loadObj('objects/octopus.obj');
  if (octopusMesh) octopusMesh = createBuffers(gl, octopusMesh);
  jellyfishMesh = await loadObj('objects/jellyfish.obj');
  if (jellyfishMesh) jellyfishMesh = createBuffers(gl, jellyfishMesh);
  seaweedMesh = createSeaweedMesh();
  seaweedTexture = loadTexture(gl, 'images/seaweed.png', true);
  turtleMesh = await loadObj('objects/turtle.obj');
  if (turtleMesh) turtleMesh = createBuffers(gl, turtleMesh);
  const octopusColors = [
    [0.67, 0.27, 0.09],
    [0.47, 0.06, 0.54]
  ];
  for (let i = 0; i < 30; i++) {
    let x = Math.random() * (MAP_SIZE * 2) - MAP_SIZE;
    let z = Math.random() * (MAP_SIZE * 2) - MAP_SIZE;
    let y = ground.getAltitude(x, z);
    if (y === null) continue;
    let scale = 10 + Math.random() * 3;
    let color = octopusColors[Math.floor(Math.random() * octopusColors.length)];
    octopuses.push(new Octopus(octopusMesh, x, y, z, scale, color));
  }
  const jellyfishColors = [
    [0.60, 0.45, 0.80],
    [0.80, 0.45, 0.68],
    [0.45, 0.49, 0.80]
  ];
  for (let i = 0; i < 30; i++) {
    let x = Math.random() * (MAP_SIZE * 2) - MAP_SIZE;
    let z = Math.random() * (MAP_SIZE * 2) - MAP_SIZE;
    let base = ground.getAltitude(x, z);
    if (base === null) continue;
    let y = base + 50;
    let scale = 20 + Math.random() * 3;
    let color = jellyfishColors[Math.floor(Math.random() * jellyfishColors.length)];
    jellyfishs.push(new Jellyfish(jellyfishMesh, x, y, z, scale, color));
  }
  for (let i = 0; i < 20; i++) {
    let x = Math.random() * (MAP_SIZE * 2) - MAP_SIZE;
    let z = Math.random() * (MAP_SIZE * 2) - MAP_SIZE;
    let y = ground.getAltitude(x, z);
    if (y === null) continue;
    let scale = 2 + Math.random() * 0.5;
    turtles.push(new Turtle(turtleMesh, x, y, z, scale, [0.04, 0.41, 0.14]));
  }
  for (let i = 0; i < 500; i++) {
    let x = Math.random() * (MAP_SIZE * 2) - MAP_SIZE;
    let z = Math.random() * (MAP_SIZE * 2) - MAP_SIZE;
    let y = ground.getAltitude(x, z) + 20;
    if (y === null) continue;
    let scale = 30 + Math.random() * 5;
    seaweedPairs.push(new SeaweedPair(x, y, z, scale));
  }
  requestAnimationFrame(renderLoop);
})();
let frameCount = 0;
let lastTimeFPS = performance.now();
let currentFPS = 0;
let lastTime = performance.now();
function measureFPS() {
  frameCount++;
  let now = performance.now();
  if (now - lastTimeFPS >= 1000) {
    currentFPS = (frameCount * 1000.0) / (now - lastTimeFPS);
    frameCount = 0;
    lastTimeFPS = now;
    document.getElementById('fpsMeter').textContent = "FPS: " + currentFPS.toFixed(2);
  }
}
function renderLoop() {
  resizeCanvas();
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  const now = performance.now();
  const dt = now - lastTime;
  lastTime = now;
  if (gameState === "playing") {
    handleKeyboard();
    player.update(dt);
    for (let f of fishes) { f.update(dt); }
    for (let s of jellyfishs) { s.update(dt); }
    updateBubbles(dt);
    remainingTime -= dt / 1000;
    if (remainingTime <= 0) {
      remainingTime = 0;
      gameState = "gameover";
      let overlay = document.getElementById("overlay");
      overlay.style.display = "flex";
      overlay.innerHTML = `<div style="text-align:center">KONIEC GRY<br/>Twój wynik: ${score}</div>`;
      document.getElementById("fpsMeter").style.display = "none";
    } else {
      let minutes = Math.floor(remainingTime / 60);
      let seconds = Math.floor(remainingTime % 60);
      let timeText = (minutes < 10 ? "0" : "") + minutes + ":" + (seconds < 10 ? "0" : "") + seconds;
      document.getElementById("fpsMeter").textContent = timeText;
    }
  } else {
    measureFPS();
  }
  const projectionMatrix = mat4.create();
  mat4.perspective(projectionMatrix, Math.PI / 4, canvas.width / canvas.height, 0.1, 2000);
  const viewMatrix = mat4.create();
  if (player) {
    const playerCenter = vec3.fromValues(player.pos[0], player.pos[1] + player.offsetY, player.pos[2]);
    const CAMERA_DISTANCE = 200;
    const CAMERA_HEIGHT = 10;
    const a2 = player.userAngle + Math.PI / 2;
    const backward = vec3.fromValues(Math.sin(a2), 0.1, Math.cos(a2));
    const cameraPos = vec3.create();
    vec3.scaleAndAdd(cameraPos, playerCenter, backward, CAMERA_DISTANCE);
    cameraPos[1] += CAMERA_HEIGHT;
    mat4.lookAt(viewMatrix, cameraPos, playerCenter, [0,1,0]);
  } else {
    mat4.identity(viewMatrix);
  }
  renderSkybox(viewMatrix, projectionMatrix);
  if (groundBuffers && groundTexture) {
    const modelMtx = mat4.create();
    renderObject(groundBuffers, groundTexture, modelMtx, viewMatrix, projectionMatrix);
  }
  if (player) player.render(viewMatrix, projectionMatrix);
  for (let coral of corals) { coral.render(viewMatrix, projectionMatrix); }
  for (let obj of goldObjects) { obj.render(goldTex, viewMatrix, projectionMatrix); }
  for (let f of fishes) { f.render(viewMatrix, projectionMatrix); }
  for (let octopus of octopuses) { octopus.render(viewMatrix, projectionMatrix); }
  for (let jellyfish of jellyfishs) { jellyfish.render(viewMatrix, projectionMatrix); }
  for (let seaweed of seaweedPairs) { seaweed.render(viewMatrix, projectionMatrix); }
  for (let turtle of turtles) { turtle.render(viewMatrix, projectionMatrix); }
  renderBubbles(viewMatrix, projectionMatrix);
  requestAnimationFrame(renderLoop);
}
