import {
  LinearSRGBColorSpace,
  Mesh,
  NoColorSpace,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Texture,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { ScreensaverEffect, ScreensaverFit } from '../../shared/screensaver';

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/**
 * La peinture, posée plein écran, puis effacée par l’orbe selon la transition choisie. uProgress
 * va de 0 (peinture entière) à 1 (écran noir) ; l’entrée joue le même chemin à l’envers.
 */
const fragmentShader = /* glsl */ `
  uniform vec2 uViewport;
  uniform vec2 uCenter;
  uniform sampler2D uCurrent;
  uniform vec2 uCurrentSize;
  uniform sampler2D uNext;
  uniform vec2 uNextSize;
  uniform float uMix;
  uniform int uEffect;
  uniform int uFit;
  uniform float uProgress;
  uniform float uGray;
  uniform float uVeil;
  uniform vec3 uRim;
  uniform vec3 uEmber;
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float value = 0.0;
    float weight = 0.5;
    for (int octave = 0; octave < 4; octave++) {
      value += weight * noise(p);
      p *= 2.03;
      weight *= 0.5;
    }
    return value;
  }

  // Jamais étirée. uFit 0 : entière, de bord à bord, sur du noir. 2 : remplit l’écran, bords
  // coupés. 1 : une image aux proportions voisines de l’écran le remplit ; les autres s’y
  // posent comme une toile, avec une ombre, sur un fond tiré de leur propre flou (mipmaps).
  vec3 painting(sampler2D tex, vec2 size, vec2 p) {
    vec2 view = uViewport;
    float cover = max(view.x / size.x, view.y / size.y);
    float contain = min(view.x / size.x, view.y / size.y);
    float fit = uFit == 0 ? contain : uFit == 2 ? cover : cover / contain < 1.22 ? cover : contain * 0.9;
    vec2 local = (p - view * 0.5) / (size * fit);
    vec3 backdrop = uFit == 0
      ? vec3(0.0)
      : texture2D(tex, (p - view * 0.5) / (size * cover * 1.1) + 0.5, 6.5).rgb * 0.3;
    vec2 outside = max(abs(p - view * 0.5) - size * fit * 0.5, 0.0);
    backdrop *= 1.0 - 0.6 * exp(-length(outside) / (0.03 * min(view.x, view.y)));
    float pixel = 1.0 / min(size.x * fit, size.y * fit);
    float inside = 1.0 - smoothstep(0.5 - pixel, 0.5, max(abs(local.x), abs(local.y)));
    return mix(backdrop, texture2D(tex, local + 0.5).rgb, inside);
  }

  // La peinture au point q, grisée selon uGray.
  vec3 shade(vec2 q, float t) {
    vec3 color = mix(painting(uCurrent, uCurrentSize, q), painting(uNext, uNextSize, q), uMix);
    float luma = dot(color, vec3(0.299, 0.587, 0.114));
    return mix(color, vec3(luma) * (1.0 - 0.3 * t), uGray);
  }

  void main() {
    vec2 p = vec2(vUv.x, 1.0 - vUv.y) * uViewport;
    vec2 d = p - uCenter;
    float reach = length(max(uCenter, uViewport - uCenter));
    float r = length(d) / reach;
    float t = uProgress;
    // Lueurs : seulement pendant le mouvement, jamais sur la peinture au repos.
    float lit = smoothstep(0.0, 0.2, t) * (1.0 - smoothstep(0.8, 1.0, t));
    float visible = 1.0;
    vec3 color;
    vec3 light = vec3(0.0);

    if (uEffect == 1) {
      // Cendres : la toile se consume depuis l’orbe, un liseré de braise en tête.
      float n = fbm(p / (0.1 * min(uViewport.x, uViewport.y)));
      float past = r * 0.72 + n * 0.32 - (t * 1.15 - 0.08);
      visible = smoothstep(0.0, 0.006, past);
      float ember = (1.0 - smoothstep(0.0, 0.05, past)) * smoothstep(0.0, 0.05, t);
      color = shade(p, t) * (1.0 - 0.65 * (1.0 - smoothstep(0.0, 0.14, past)) * smoothstep(0.0, 0.05, t));
      color = mix(color, uEmber * 1.5, ember * 0.85);
      light = uEmber * exp(min(past, 0.0) / 0.012) * (1.0 - visible) * lit * 0.7;
    } else if (uEffect == 2) {
      // Onde : un anneau parti de l’orbe déforme la toile et ne laisse que le noir derrière lui.
      float gap = r - (t * 1.3 - 0.05);
      float bend = sin(gap * 55.0) * exp(-abs(gap) * 14.0) * 0.025 * smoothstep(0.0, 0.08, t);
      vec2 q = uCenter + d / max(length(d), 0.0001) * (r + bend) * reach;
      visible = smoothstep(-0.005, 0.03, gap);
      color = shade(q, t) * (1.0 + 0.6 * exp(-abs(gap) * 20.0) * lit);
      light = uRim * exp(-abs(gap) * reach / 6.0) * lit * 0.8;
    } else if (uEffect == 3) {
      // Mosaïque : la toile se défait en carreaux qui tournent et fondent, de l’orbe vers les bords.
      float cell = min(uViewport.x, uViewport.y) / 12.0;
      vec2 id = floor(p / cell);
      vec2 middle = (id + 0.5) * cell;
      float delay = length(middle - uCenter) / reach * 0.55 + hash(id) * 0.2;
      float local = clamp((t - delay) / 0.22, 0.0, 1.0);
      float size = 1.0 - local * local * (3.0 - 2.0 * local);
      float angle = local * (hash(id + 3.1) - 0.5) * 3.0;
      vec2 offset = mat2(cos(angle), sin(angle), -sin(angle), cos(angle)) * (p - middle);
      if (local > 0.0)
        visible = 1.0 - smoothstep(cell * 0.5 * size - 1.5, cell * 0.5 * size, max(abs(offset.x), abs(offset.y)));
      color = shade(middle + offset / max(size, 0.001), t) * (1.0 + local * 0.9);
    } else if (uEffect == 5) {
      // Fondu : la toile s’éteint vers le noir, en gardant ses couleurs.
      color = shade(p, t);
      visible = 1.0 - t;
    } else if (uEffect == 4) {
      // Rideau : la toile s’ouvre en deux depuis l’orbe, chaque moitié glisse vers son bord.
      float shift = t * (max(uCenter.x, uViewport.x - uCenter.x) + 40.0);
      float side = p.x < uCenter.x ? 1.0 : -1.0;
      vec2 q = p + vec2(side * shift, 0.0);
      float seam = side * (uCenter.x - q.x);
      visible = smoothstep(-0.75, 0.75, seam);
      color = shade(q, t) * (1.0 - 0.45 * exp(-max(seam, 0.0) / 70.0) * smoothstep(0.0, 0.1, t));
      light = uRim * exp(-abs(seam) / 14.0) * lit * 0.6;
    } else {
      // Aspiration : la toile s’enroule autour de l’orbe et s’y effondre, en ouvrant au milieu
      // un trou qui laisse paraître le noir.
      float scale = max(1.0 - t, 0.0001);
      float source = r / scale;
      float angle = atan(d.y, d.x) - t * (1.4 + 7.0 * exp(-source * 1.8));
      vec2 q = uCenter + vec2(cos(angle), sin(angle)) * source * reach;
      float edge = min(min(q.x, uViewport.x - q.x), min(q.y, uViewport.y - q.y)) * scale;
      float hole = t * 0.26;
      float holeEdge = 0.08 - t * 0.06;
      visible = smoothstep(-0.75, 0.75, edge) * smoothstep(hole - holeEdge, hole, r);
      color = shade(q, t);
      float glow = exp(-abs(edge) / 18.0) * 0.5 + exp(-abs(r - hole) * reach / 10.0) * smoothstep(0.08, 0.2, hole);
      light = uRim * glow * lit * 0.45;
    }
    gl_FragColor = vec4((color * visible + light) * uVeil, 1.0);
  }
`;

/** Numéro de chaque placement dans le shader. */
const fitIndex: Record<ScreensaverFit, number> = { whole: 0, canvas: 1, fill: 2 };

/** Numéro de chaque transition dans le shader. */
const effectIndex: Record<ScreensaverEffect, number> = {
  vortex: 0,
  embers: 1,
  ripple: 2,
  mosaic: 3,
  curtain: 4,
  fade: 5,
};

export interface ScreensaverFrame {
  width: number;
  height: number;
  center: { x: number; y: number };
  effect: ScreensaverEffect;
  fit: ScreensaverFit;
  progress: number;
  gray: number;
  veil: number;
  mix: number;
}

export type ScreensaverSlot = 'current' | 'next';

/** Une seule surface plein écran ; rien n’est dessiné entre deux changements. */
export function createScreensaverRenderer(canvas: HTMLCanvasElement) {
  const renderer = new WebGLRenderer({
    canvas,
    alpha: false,
    antialias: false,
    powerPreference: 'low-power',
  });
  // Couleurs telles quelles, de l’image à l’écran : le shader ne fait aucune conversion.
  renderer.outputColorSpace = LinearSRGBColorSpace;
  renderer.setClearColor(0x000000, 1);
  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const uniforms = {
    uViewport: { value: new Vector2(1, 1) },
    uCenter: { value: new Vector2() },
    uCurrent: { value: null as Texture | null },
    uCurrentSize: { value: new Vector2(1, 1) },
    uNext: { value: null as Texture | null },
    uNextSize: { value: new Vector2(1, 1) },
    uMix: { value: 0 },
    uEffect: { value: 0 },
    uFit: { value: 1 },
    uProgress: { value: 0 },
    uGray: { value: 0 },
    uVeil: { value: 1 },
    uRim: { value: new Vector3(0.55, 0.68, 1) },
    uEmber: { value: new Vector3(1, 0.52, 0.18) },
  };
  const geometry = new PlaneGeometry(2, 2);
  const material = new ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
  });
  scene.add(new Mesh(geometry, material));
  const textures: Record<ScreensaverSlot, Texture | null> = { current: null, next: null };
  const release = (texture: Texture | null) => {
    texture?.dispose();
    (texture?.image as ImageBitmap | undefined)?.close();
  };

  return {
    resize(width: number, height: number, ratio: number) {
      renderer.setPixelRatio(Math.min(ratio, 2, Math.sqrt(4_000_000 / (width * height))));
      renderer.setSize(width, height, false);
    },
    /** Remplace l’image d’un emplacement ; le moteur garde l’image et libère l’ancienne. */
    set(slot: ScreensaverSlot, bitmap: ImageBitmap | null) {
      release(textures[slot]);
      textures[slot] = null;
      if (!bitmap) return;
      const texture = new Texture(bitmap);
      texture.colorSpace = NoColorSpace;
      texture.needsUpdate = true;
      textures[slot] = texture;
      (slot === 'current' ? uniforms.uCurrentSize : uniforms.uNextSize).value.set(
        bitmap.width,
        bitmap.height,
      );
    },
    /** L’image suivante devient l’image affichée, après un fondu. */
    promote() {
      release(textures.current);
      textures.current = textures.next;
      textures.next = null;
      uniforms.uCurrentSize.value.copy(uniforms.uNextSize.value);
    },
    render(frame: ScreensaverFrame) {
      if (!textures.current) return;
      uniforms.uViewport.value.set(frame.width, frame.height);
      uniforms.uCenter.value.set(frame.center.x, frame.center.y);
      uniforms.uCurrent.value = textures.current;
      uniforms.uNext.value = textures.next ?? textures.current;
      uniforms.uMix.value = textures.next ? frame.mix : 0;
      uniforms.uEffect.value = effectIndex[frame.effect];
      uniforms.uFit.value = fitIndex[frame.fit];
      uniforms.uProgress.value = frame.progress;
      uniforms.uGray.value = frame.gray;
      uniforms.uVeil.value = frame.veil;
      renderer.render(scene, camera);
    },
    dispose() {
      release(textures.current);
      release(textures.next);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    },
  };
}
