// WebGL2 drawing of one frame.
// 1. Fill: the morphed outlines as triangle fans into the stencil of a multisampled buffer (nonzero: front faces add,
//    back faces subtract; even-odd: invert), then a cover pass where the stencil is set; resolved into a coverage
//    texture. Self-intersections of an in-between outline are handled by the fill rule.
// 2. Glow: coverage × the colour mask at a quarter of the size, blurred (separable Gaussian, two rounds) by Bleed.
// 3. Composite: one shader paints ink, the acid gradient (domain-warped noise, flowing, with brighter blotches), the
//    glow inside the letters, the halo spilling out of them and the wash (a colour field straight from the colour
//    mask, with an edge that is hard in places, soft in others and dissolves in a few), over the background or
//    transparent.

import type { GradientStop } from '../state/settings'
import { hexToRgb, slantDirection, type Rgb } from './gradient'

export interface FrameLook {
  ink: string
  background: string
  transparent: boolean
  stops: readonly GradientStop[]
  slant: number
  flow: number
  noise: number
  glow: number
  spill: number
  /** Wash: the colour field's opacity (0 off), body (0 soft falloff, 1 solid with an edge), edge variety, dissolve. */
  wash: number
  washBody: number
  washEdge: number
  washDissolve: number
  bleed: number
  fillRule: 'nonzero' | 'evenodd'
  /** Seconds since start, for the flowing colour. */
  time: number
}

const MAX_STOPS = 8
const GLOW_DIVISOR = 4

const FILL_VS = `#version 300 es
in vec2 aPos;
uniform vec2 uSize;
void main() {
  gl_Position = vec4(aPos.x / uSize.x * 2.0 - 1.0, 1.0 - aPos.y / uSize.y * 2.0, 0.0, 1.0);
}`

const FLAT_FS = `#version 300 es
precision mediump float;
out vec4 o;
void main() { o = vec4(1.0); }`

const QUAD_VS = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

// vUv is y up (GL); the mask is stored y down (canvas rows), hence the flip.
const GLOW_SRC_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uCov;
uniform sampler2D uMask;
uniform vec2 uMaskScale;
out vec4 o;
void main() {
  float cov = texture(uCov, vUv).r;
  float c = texture(uMask, vec2(vUv.x, 1.0 - vUv.y) * uMaskScale).g;
  o = vec4(cov * c, 0.0, 0.0, 1.0);
}`

const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uStep;
out vec4 o;
void main() {
  float w[5] = float[](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
  float s = texture(uSrc, vUv).r * w[0];
  for (int i = 1; i < 5; i++) {
    s += texture(uSrc, vUv + uStep * float(i)).r * w[i];
    s += texture(uSrc, vUv - uStep * float(i)).r * w[i];
  }
  o = vec4(s, 0.0, 0.0, 1.0);
}`

const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uCov;
uniform sampler2D uMask;
uniform sampler2D uGlow;
uniform vec2 uMaskScale;
uniform vec3 uInk;
uniform vec3 uBg;
uniform float uTransparent;
uniform vec3 uStops[${MAX_STOPS}];
uniform float uPos[${MAX_STOPS}];
uniform int uCount;
uniform vec2 uDir;
uniform float uReach;
uniform float uAspect;
uniform float uTime;
uniform float uNoise;
uniform float uGlowAmt;
uniform float uSpill;
uniform float uWash;
uniform float uWashBody;
uniform float uWashEdge;
uniform float uWashDissolve;
out vec4 o;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec2(17.1, 9.2);
    a *= 0.5;
  }
  return s / 0.9375;
}
vec3 gradientAt(float t) {
  vec3 col = uStops[0];
  for (int i = 1; i < ${MAX_STOPS}; i++) {
    if (i >= uCount) break;
    float span = max(uPos[i] - uPos[i - 1], 1e-5);
    col = mix(col, uStops[i], clamp((t - uPos[i - 1]) / span, 0.0, 1.0));
  }
  return col;
}
vec3 saturateColor(vec3 c, float amount) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return clamp(mix(vec3(l), c, 1.0 + amount), 0.0, 1.0);
}

void main() {
  vec2 p = vec2(vUv.x, 1.0 - vUv.y);
  vec2 mUv = p * uMaskScale;
  float cov = texture(uCov, vUv).r;
  float c = texture(uMask, mUv).g;
  float glow = texture(uGlow, vUv).r;

  // The gradient runs along the slant; noise warps it so the colours bleed into one another and drift.
  vec2 q = (p - 0.5) * vec2(uAspect, 1.0);
  float s = dot(q, uDir) / uReach + 0.5;
  vec2 w = q * 2.4;
  float n1 = fbm(w + vec2(uTime * 0.31, -uTime * 0.23));
  float n2 = fbm(w * 1.6 + vec2(-uTime * 0.17, uTime * 0.29) + n1 * 1.7);
  s += uNoise * (n2 - 0.5) * 1.1 + uTime * 0.07;
  float m = mod(s, 2.0);
  s = m > 1.0 ? 2.0 - m : m;
  vec3 col = gradientAt(s);
  // Blotches: patches brighter and more saturated than the rest.
  float blot = smoothstep(0.5, 0.82, fbm(w * 0.8 + vec2(-uTime * 0.2, uTime * 0.13) + 31.0));
  col = saturateColor(col * (1.0 + 0.45 * blot * uNoise), 0.35 + 0.4 * blot * uNoise);

  // Wash: the colour mask itself as a field of colour, warped by slow noise so its edge rises and recedes. How sharp
  // the edge is varies from place to place (Edge variety), and some patches fade out into the background (Dissolve).
  float wash = 0.0;
  if (uWash > 0.0) {
    vec2 g = q * 3.0;
    vec2 warp = vec2(fbm(g + vec2(uTime * 0.11, 5.3)), fbm(g + vec2(-7.1, -uTime * 0.09))) - 0.5;
    float f = texture(uMask, (p + warp * vec2(1.0 / uAspect, 1.0) * 0.05 * (0.3 + uWashEdge)) * uMaskScale).g;
    float sharp = smoothstep(0.3, 0.7, fbm(g * 0.6 + vec2(11.0, uTime * 0.05)));
    float soft = mix(0.16, mix(0.42, 0.012, sharp), uWashEdge);
    float body = smoothstep(0.3 - soft, 0.3 + soft, f);
    float a = mix(f, max(body, f * 0.5), uWashBody);
    float gone = smoothstep(0.42, 0.78, fbm(g * 0.8 + vec2(-23.0, uTime * 0.07)));
    wash = clamp(a * (1.0 - uWashDissolve * gone) * uWash, 0.0, 1.0);
  }
  vec3 washCol = saturateColor(col, 0.2);

  // Inside the letters: ink where the brush has not been, glowing acid colour where it has. Over the wash, part of the
  // ink stays so the letters show in the colour.
  vec3 lit = col * (1.0 + 0.3 * uGlowAmt * c);
  vec3 letter = mix(uInk, lit, c * (1.0 - 0.45 * wash)) + col * glow * uGlowAmt * 0.45;
  // Outside them: the halo the lit letters throw (none at Spill 0), and the wash.
  float halo = clamp(glow * uGlowAmt * uSpill * 1.6, 0.0, 1.0);
  vec3 haloCol = saturateColor(col * 1.15, 0.3);

  if (uTransparent > 0.5) {
    float out_a = 1.0 - (1.0 - halo) * (1.0 - wash);
    vec3 out_c = haloCol * halo * (1.0 - wash) + washCol * wash;
    o = vec4(clamp(letter, 0.0, 1.0) * cov + out_c * (1.0 - cov), cov + (1.0 - cov) * out_a);
  } else {
    vec3 bg = mix(mix(uBg, haloCol, halo), washCol, wash);
    o = vec4(mix(bg, clamp(letter, 0.0, 1.0), cov), 1.0);
  }
}`

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
    throw new Error(
      gl.isContextLost()
        ? 'The WebGL context was lost. Reload the page.'
        : `Shader error: ${gl.getShaderInfoLog(shader) || 'unknown'}`,
    )
  return shader
}

interface Program {
  program: WebGLProgram
  u: Record<string, WebGLUniformLocation | null>
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string, uniforms: string[]): Program {
  const p = gl.createProgram()!
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs))
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs))
  gl.bindAttribLocation(p, 0, 'aPos')
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error(`Shader link error: ${gl.getProgramInfoLog(p) || 'unknown'}`)
  return { program: p, u: Object.fromEntries(uniforms.map((n) => [n, gl.getUniformLocation(p, n)])) }
}

interface Target {
  fb: WebGLFramebuffer
  tex: WebGLTexture
  w: number
  h: number
}

export class AcidRenderer {
  readonly gl: WebGL2RenderingContext
  private fill: Program
  private cover: Program
  private glowSrc: Program
  private blur: Program
  private composite: Program
  private vao: WebGLVertexArrayObject
  private quadVao: WebGLVertexArrayObject
  private vbo: WebGLBuffer
  private vertexCount = 0
  private maskTex: WebGLTexture
  private maskBytes = new Uint8Array(0)
  private maskScale: [number, number] = [1, 1]
  private msFb: WebGLFramebuffer | null = null
  private msColor: WebGLRenderbuffer | null = null
  private msStencil: WebGLRenderbuffer | null = null
  private coverage: Target | null = null
  private glowA: Target | null = null
  private glowB: Target | null = null
  private width = 0
  private height = 0
  private samples: number

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      // Kept, so the recorder and Save PNG can read the frame after it was drawn.
      preserveDrawingBuffer: true,
      antialias: false,
      depth: false,
      stencil: false,
    })
    if (!gl) throw new Error('This browser does not support WebGL2.')
    this.gl = gl
    this.samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) as number)
    this.fill = program(gl, FILL_VS, FLAT_FS, ['uSize'])
    this.cover = program(gl, QUAD_VS, FLAT_FS, [])
    this.glowSrc = program(gl, QUAD_VS, GLOW_SRC_FS, ['uCov', 'uMask', 'uMaskScale'])
    this.blur = program(gl, QUAD_VS, BLUR_FS, ['uSrc', 'uStep'])
    this.composite = program(gl, QUAD_VS, COMPOSITE_FS, [
      'uCov',
      'uMask',
      'uGlow',
      'uMaskScale',
      'uInk',
      'uBg',
      'uTransparent',
      'uStops',
      'uPos',
      'uCount',
      'uDir',
      'uReach',
      'uAspect',
      'uTime',
      'uNoise',
      'uGlowAmt',
      'uSpill',
      'uWash',
      'uWashBody',
      'uWashEdge',
      'uWashDissolve',
    ])
    this.vao = gl.createVertexArray()!
    this.vbo = gl.createBuffer()!
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    this.quadVao = gl.createVertexArray()!
    gl.bindVertexArray(null)
    this.maskTex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }

  private target(w: number, h: number, old: Target | null): Target {
    const gl = this.gl
    if (old) {
      gl.deleteFramebuffer(old.fb)
      gl.deleteTexture(old.tex)
    }
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const fb = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    return { fb, tex, w, h }
  }

  /** The canvas size, and the mask grid (cells of `cell` canvas pixels). */
  resize(width: number, height: number, cols: number, rows: number, cell: number): void {
    const gl = this.gl
    this.maskScale = [width / (cols * cell), height / (rows * cell)]
    if (this.maskBytes.length !== cols * rows * 2) {
      this.maskBytes = new Uint8Array(cols * rows * 2)
      gl.bindTexture(gl.TEXTURE_2D, this.maskTex)
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, cols, rows, 0, gl.RG, gl.UNSIGNED_BYTE, this.maskBytes)
    }
    this.maskCols = cols
    this.maskRows = rows
    if (width === this.width && height === this.height) return
    this.width = width
    this.height = height
    const canvas = gl.canvas as HTMLCanvasElement
    canvas.width = width
    canvas.height = height
    if (this.msFb) gl.deleteFramebuffer(this.msFb)
    if (this.msColor) gl.deleteRenderbuffer(this.msColor)
    if (this.msStencil) gl.deleteRenderbuffer(this.msStencil)
    this.msColor = gl.createRenderbuffer()!
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.msColor)
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.RGBA8, width, height)
    this.msStencil = gl.createRenderbuffer()!
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.msStencil)
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.DEPTH24_STENCIL8, width, height)
    this.msFb = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.msFb)
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.msColor)
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, this.msStencil)
    this.coverage = this.target(width, height, this.coverage)
    const gw = Math.max(1, Math.round(width / GLOW_DIVISOR))
    const gh = Math.max(1, Math.round(height / GLOW_DIVISOR))
    this.glowA = this.target(gw, gh, this.glowA)
    this.glowB = this.target(gw, gh, this.glowB)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  private maskCols = 0
  private maskRows = 0

  /** Triangle fans of every contour (x, y canvas pixels, three vertices a triangle). */
  setGlyphs(vertices: Float32Array, count: number): void {
    const gl = this.gl
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo)
    gl.bufferData(gl.ARRAY_BUFFER, vertices.subarray(0, count * 2), gl.DYNAMIC_DRAW)
    this.vertexCount = count
  }

  uploadMask(morph: Float32Array, color: Float32Array): void {
    const gl = this.gl
    const bytes = this.maskBytes
    for (let i = 0; i < morph.length; i++) {
      bytes[2 * i] = Math.round(Math.min(1, morph[i]) * 255)
      bytes[2 * i + 1] = Math.round(Math.min(1, color[i]) * 255)
    }
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.maskCols, this.maskRows, gl.RG, gl.UNSIGNED_BYTE, bytes)
  }

  private quad(p: Program, target: Target | null): void {
    const gl = this.gl
    gl.useProgram(p.program)
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null)
    gl.viewport(0, 0, target ? target.w : this.width, target ? target.h : this.height)
    gl.bindVertexArray(this.quadVao)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  private bind(unit: number, tex: WebGLTexture, loc: WebGLUniformLocation | null): void {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.uniform1i(loc, unit)
  }

  render(look: FrameLook): void {
    const gl = this.gl
    const cov = this.coverage
    const glowA = this.glowA
    const glowB = this.glowB
    if (!cov || !glowA || !glowB || !this.msFb) return
    const { width, height } = this

    // 1. Fill into the stencil, then cover where it is set.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.msFb)
    gl.viewport(0, 0, width, height)
    gl.clearColor(0, 0, 0, 0)
    gl.clearStencil(0)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT)
    if (this.vertexCount > 0) {
      gl.enable(gl.STENCIL_TEST)
      gl.colorMask(false, false, false, false)
      gl.stencilFunc(gl.ALWAYS, 0, 0xff)
      if (look.fillRule === 'evenodd') {
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT)
      } else {
        gl.stencilOpSeparate(gl.FRONT, gl.KEEP, gl.KEEP, gl.INCR_WRAP)
        gl.stencilOpSeparate(gl.BACK, gl.KEEP, gl.KEEP, gl.DECR_WRAP)
      }
      gl.useProgram(this.fill.program)
      gl.uniform2f(this.fill.u.uSize, width, height)
      gl.bindVertexArray(this.vao)
      gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount)
      gl.colorMask(true, true, true, true)
      gl.stencilFunc(gl.NOTEQUAL, 0, 0xff)
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP)
      gl.useProgram(this.cover.program)
      gl.bindVertexArray(this.quadVao)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      gl.disable(gl.STENCIL_TEST)
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.msFb)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, cov.fb)
    gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST)
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)

    // 2. The lit ink at a quarter size, blurred twice by Bleed.
    gl.useProgram(this.glowSrc.program)
    this.bind(0, cov.tex, this.glowSrc.u.uCov)
    this.bind(1, this.maskTex, this.glowSrc.u.uMask)
    gl.uniform2f(this.glowSrc.u.uMaskScale, this.maskScale[0], this.maskScale[1])
    this.quad(this.glowSrc, glowA)
    const radius = 1 + look.bleed * 0.09 * glowA.h
    for (const spread of [radius / 4, radius / 9]) {
      gl.useProgram(this.blur.program)
      this.bind(0, glowA.tex, this.blur.u.uSrc)
      gl.uniform2f(this.blur.u.uStep, spread / glowA.w, 0)
      this.quad(this.blur, glowB)
      this.bind(0, glowB.tex, this.blur.u.uSrc)
      gl.uniform2f(this.blur.u.uStep, 0, spread / glowA.h)
      this.quad(this.blur, glowA)
    }

    // 3. Composite to the canvas.
    const c = this.composite
    gl.useProgram(c.program)
    this.bind(0, cov.tex, c.u.uCov)
    this.bind(1, this.maskTex, c.u.uMask)
    this.bind(2, glowA.tex, c.u.uGlow)
    gl.uniform2f(c.u.uMaskScale, this.maskScale[0], this.maskScale[1])
    gl.uniform3fv(c.u.uInk, [...hexToRgb(look.ink)])
    gl.uniform3fv(c.u.uBg, [...hexToRgb(look.background)])
    gl.uniform1f(c.u.uTransparent, look.transparent ? 1 : 0)
    const stops = look.stops.slice(0, MAX_STOPS)
    const colors = new Float32Array(MAX_STOPS * 3)
    const pos = new Float32Array(MAX_STOPS)
    stops.forEach((s, i) => {
      const rgb: Rgb = hexToRgb(s.color)
      colors.set(rgb, i * 3)
      pos[i] = s.pos
    })
    gl.uniform3fv(c.u.uStops, colors)
    gl.uniform1fv(c.u.uPos, pos)
    gl.uniform1i(c.u.uCount, stops.length)
    const dir = slantDirection(look.slant)
    const aspect = width / height
    gl.uniform2f(c.u.uDir, dir.x, dir.y)
    gl.uniform1f(c.u.uReach, Math.abs(dir.x) * aspect + Math.abs(dir.y))
    gl.uniform1f(c.u.uAspect, aspect)
    gl.uniform1f(c.u.uTime, look.time * look.flow)
    gl.uniform1f(c.u.uNoise, look.noise)
    gl.uniform1f(c.u.uGlowAmt, look.glow)
    gl.uniform1f(c.u.uSpill, look.spill)
    gl.uniform1f(c.u.uWash, look.wash)
    gl.uniform1f(c.u.uWashBody, look.washBody)
    gl.uniform1f(c.u.uWashEdge, look.washEdge)
    gl.uniform1f(c.u.uWashDissolve, look.washDissolve)
    this.quad(c, null)
  }

  /** Frees the buffers; the context stays, since a canvas gives the same one to the next renderer. */
  dispose(): void {
    const gl = this.gl
    for (const t of [this.coverage, this.glowA, this.glowB]) {
      if (!t) continue
      gl.deleteFramebuffer(t.fb)
      gl.deleteTexture(t.tex)
    }
    if (this.msFb) gl.deleteFramebuffer(this.msFb)
    if (this.msColor) gl.deleteRenderbuffer(this.msColor)
    if (this.msStencil) gl.deleteRenderbuffer(this.msStencil)
    gl.deleteTexture(this.maskTex)
    gl.deleteBuffer(this.vbo)
    for (const p of [this.fill, this.cover, this.glowSrc, this.blur, this.composite]) gl.deleteProgram(p.program)
  }
}
