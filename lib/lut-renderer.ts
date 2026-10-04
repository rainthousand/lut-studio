export type CubeLut = {
  size: number;
  pixels: Uint8Array;
};

const lutCache = new Map<string, Promise<CubeLut>>();

export function loadCubeLut(profile: string, key: string) {
  const cacheKey = `${profile}/${key}`;
  const cached = lutCache.get(cacheKey);
  if (cached) return cached;

  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const task = fetch(`${basePath}/luts/${profile}/${key}.cube`)
    .then((response) => {
      if (!response.ok) throw new Error(`LUT 加载失败：${response.status}`);
      return response.text();
    })
    .then(parseCubeLut);

  lutCache.set(cacheKey, task);
  return task;
}

function parseCubeLut(source: string): CubeLut {
  let size = 0;
  const values: number[] = [];

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("TITLE")) continue;
    if (line.startsWith("LUT_3D_SIZE")) {
      size = Number(line.split(/\s+/).at(-1));
      continue;
    }
    if (/^(DOMAIN_MIN|DOMAIN_MAX)/.test(line)) continue;
    const triplet = line.split(/\s+/).map(Number);
    if (triplet.length >= 3 && triplet.every(Number.isFinite)) values.push(...triplet.slice(0, 3));
  }

  if (!size || values.length !== size ** 3 * 3) {
    throw new Error("LUT 文件格式不正确或数据不完整。");
  }

  const pixels = new Uint8Array(size ** 3 * 4);
  for (let sourceIndex = 0, targetIndex = 0; sourceIndex < values.length; sourceIndex += 3, targetIndex += 4) {
    pixels[targetIndex] = Math.round(Math.min(1, Math.max(0, values[sourceIndex])) * 255);
    pixels[targetIndex + 1] = Math.round(Math.min(1, Math.max(0, values[sourceIndex + 1])) * 255);
    pixels[targetIndex + 2] = Math.round(Math.min(1, Math.max(0, values[sourceIndex + 2])) * 255);
    pixels[targetIndex + 3] = 255;
  }

  return { size, pixels };
}

const vertexShader = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 point = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = vec2(point.x, 1.0 - point.y);
  gl_Position = vec4(point * 2.0 - 1.0, 0.0, 1.0);
}`;

const fragmentShader = `#version 300 es
precision highp float;
precision highp sampler3D;
uniform sampler2D uImage;
uniform sampler3D uLut;
uniform float uStrength;
in vec2 vUv;
out vec4 color;
void main() {
  vec4 source = texture(uImage, vUv);
  vec3 graded = texture(uLut, clamp(source.rgb, 0.0, 1.0)).rgb;
  color = vec4(mix(source.rgb, graded, uStrength), source.a);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("无法创建图形着色器。");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? "着色器编译失败。");
  }
  return shader;
}

export class LutRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private imageTexture: WebGLTexture;
  private lutTexture: WebGLTexture;
  private vao: WebGLVertexArrayObject;
  private strengthLocation: WebGLUniformLocation;
  private bitmap: ImageBitmap | null = null;
  private currentLut: CubeLut | null = null;
  private currentStrength = 1;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
      premultipliedAlpha: false,
    });
    if (!gl) throw new Error("当前浏览器不支持 WebGL 2，无法应用 LUT。");
    this.gl = gl;

    const program = gl.createProgram();
    if (!program) throw new Error("无法创建图形处理程序。");
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertexShader));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentShader));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? "图形处理程序链接失败。");
    }
    this.program = program;

    const imageTexture = gl.createTexture();
    const lutTexture = gl.createTexture();
    const vao = gl.createVertexArray();
    const strengthLocation = gl.getUniformLocation(program, "uStrength");
    if (!imageTexture || !lutTexture || !vao || !strengthLocation) throw new Error("无法创建图像纹理。");
    this.imageTexture = imageTexture;
    this.lutTexture = lutTexture;
    this.vao = vao;
    this.strengthLocation = strengthLocation;

    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.uniform1i(gl.getUniformLocation(program, "uImage"), 0);
    gl.uniform1i(gl.getUniformLocation(program, "uLut"), 1);
  }

  setImage(bitmap: ImageBitmap) {
    this.bitmap?.close();
    this.bitmap = bitmap;
    const maxSize = this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) as number;
    const ratio = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * ratio));
    const height = Math.max(1, Math.round(bitmap.height * ratio));
    this.canvas.width = width;
    this.canvas.height = height;

    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.imageTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    if (ratio === 1) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    } else {
      const resized = document.createElement("canvas");
      resized.width = width;
      resized.height = height;
      const context = resized.getContext("2d", { alpha: false });
      if (!context) throw new Error("无法缩放超大照片。");
      context.drawImage(bitmap, 0, 0, width, height);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, resized);
    }
    this.draw();
    return { width, height, resized: ratio < 1 };
  }

  setLut(lut: CubeLut) {
    this.currentLut = lut;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTexture);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, lut.size, lut.size, lut.size, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut.pixels);
    this.draw();
  }

  setStrength(strength: number) {
    this.currentStrength = Math.min(1, Math.max(0, strength));
    this.draw();
  }

  private draw() {
    if (!this.bitmap || !this.currentLut) return;
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform1f(this.strengthLocation, this.currentStrength);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  async export(type: "image/jpeg" | "image/png") {
    this.draw();
    const quality = type === "image/jpeg" ? 0.95 : undefined;
    const blob = await new Promise<Blob | null>((resolve) => this.canvas.toBlob(resolve, type, quality));
    if (!blob) throw new Error("照片导出失败。");
    return blob;
  }

  dispose() {
    this.bitmap?.close();
    this.gl.deleteTexture(this.imageTexture);
    this.gl.deleteTexture(this.lutTexture);
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteProgram(this.program);
  }
}
