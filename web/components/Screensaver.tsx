import { useEffect, useRef, useState } from 'react';
import {
  SCREENSAVER_RANDOM_EFFECTS,
  type ScreensaverEffect,
  type ScreensaverFit,
  type ScreensaverImage,
  type ScreensaverTransition,
} from '../../shared/screensaver';
import { api } from '../api';
import {
  createScreensaverRenderer,
  type ScreensaverFrame,
  type ScreensaverSlot,
} from './screensaver-renderer';

/**
 * off : rien n’est affiché. entering : la peinture sort de l’orbe endormie. on : la peinture
 * occupe l’écran. leaving : l’orbe s’éveille devant elle et l’efface.
 */
export type ScreensaverScene = 'off' | 'entering' | 'on' | 'leaving';

type Values = Pick<ScreensaverFrame, 'progress' | 'gray' | 'veil' | 'mix'>;
type Ease = (t: number) => number;
interface Tween {
  from: number;
  to: number;
  start: number;
  duration: number;
  ease: Ease;
}

const easeIn: Ease = (t) => t * t * t;
const easeOut: Ease = (t) => 1 - (1 - t) ** 3;
const easeInOut: Ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const CROSSFADE_MS = 2_400;
/** Plus grand côté envoyé à la carte graphique : au-delà, l’image est réduite au chargement. */
const MAX_SIDE = 2_560;

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[other]] = [copy[other]!, copy[index]!];
  }
  return copy;
}

async function loadBitmap(image: ScreensaverImage): Promise<ImageBitmap> {
  const response = await fetch(image.url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Image ${image.id} : ${response.status}`);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const ratio = MAX_SIDE / Math.max(bitmap.width, bitmap.height);
  if (ratio >= 1) return bitmap;
  bitmap.close();
  return createImageBitmap(blob, {
    resizeWidth: Math.round(bitmap.width * ratio),
    resizeHeight: Math.round(bitmap.height * ratio),
    resizeQuality: 'high',
  });
}

/** Peintures et photos plein écran, derrière l’orbe, quand personne n’est devant le miroir. */
export function Screensaver({
  active,
  revision,
  intervalMs,
  transition,
  durationMs,
  fit,
  onSceneChange,
}: {
  active: boolean;
  revision: string;
  intervalMs: number;
  transition: ScreensaverTransition;
  /** Durée de la disparition de l’image ; le retour prend 1,6 fois plus. */
  durationMs: number;
  fit: ScreensaverFit;
  onSceneChange: (scene: ScreensaverScene) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scene, setScene] = useState<ScreensaverScene>('off');
  const [caption, setCaption] = useState<ScreensaverImage | null>(null);
  const [fallback, setFallback] = useState<{ current: string; next: string | null } | null>(null);
  const fallbackRef = useRef<HTMLDivElement>(null);
  const engine = useRef<{
    wake: (active: boolean) => void;
    setImages: (images: ScreensaverImage[]) => void;
    setInterval: (ms: number) => void;
    setTransition: (transition: ScreensaverTransition) => void;
    setDuration: (ms: number) => void;
    setFit: (fit: ScreensaverFit) => void;
  } | null>(null);
  const sceneChanged = useRef(onSceneChange);
  sceneChanged.current = onSceneChange;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: ReturnType<typeof createScreensaverRenderer> | null = null;
    try {
      renderer = createScreensaverRenderer(canvas);
    } catch {
      // Sans WebGL : la même chorégraphie, jouée par CSS sur deux images.
      renderer = null;
    }
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const values: Values = { progress: 1, gray: 1, veil: 1, mix: 0 };
    const tweens = new Map<keyof Values, Tween>();
    let current: ScreensaverImage | null = null;
    let next: ScreensaverImage | null = null;
    let images: ScreensaverImage[] = [];
    let bag: ScreensaverImage[] = [];
    let stage: ScreensaverScene = 'off';
    let wanted = false;
    let interval = intervalMs;
    let style = transition;
    let duration = durationMs;
    let placement = fit;
    let effect: ScreensaverEffect = 'vortex';
    let slideshow: ReturnType<typeof setTimeout> | null = null;
    let loading = false;
    let frame = 0;
    let disposed = false;
    let size = { width: 0, height: 0, ratio: 0 };

    const changeStage = (value: ScreensaverScene) => {
      if (stage === value) return;
      stage = value;
      setScene(value);
      sceneChanged.current(value);
    };
    const animate = (
      key: keyof Values,
      to: number,
      duration: number,
      delay = 0,
      ease = easeOut,
    ) => {
      const now = performance.now();
      if (duration <= 0 && delay <= 0) {
        values[key] = to;
        tweens.delete(key);
        return;
      }
      tweens.set(key, { from: values[key], to, start: now + delay, duration, ease });
    };
    const center = () => {
      const bounds = canvas.getBoundingClientRect();
      const anchor = canvas
        .closest('.mirror-page')
        ?.querySelector('.mirror-orb-anchor')
        ?.getBoundingClientRect();
      return anchor
        ? {
            x: anchor.left - bounds.left + anchor.width / 2,
            y: anchor.top - bounds.top + anchor.height / 2,
          }
        : { x: bounds.width / 2, y: bounds.height / 2 };
    };
    const paint = () => {
      const bounds = canvas.getBoundingClientRect();
      const width = bounds.width || innerWidth;
      const height = bounds.height || innerHeight;
      const middle = center();
      if (renderer) {
        if (size.width !== width || size.height !== height || size.ratio !== devicePixelRatio) {
          size = { width, height, ratio: devicePixelRatio };
          renderer.resize(width, height, devicePixelRatio);
        }
        renderer.render({ width, height, center: middle, effect, fit: placement, ...values });
        return;
      }
      const layer = fallbackRef.current;
      if (!layer) return;
      layer.style.transformOrigin = `${middle.x}px ${middle.y}px`;
      layer.style.transform = `rotate(${-values.progress * 220}deg) scale(${Math.max(0, 1 - values.progress)})`;
      layer.style.filter = `grayscale(${values.gray}) brightness(${1 - 0.3 * values.progress})`;
      layer.style.opacity = String(values.veil);
      layer.style.setProperty('--screensaver-mix', String(values.mix));
    };
    /** Fin d’un mouvement : ce que la scène devient ensuite. */
    const settle = () => {
      if (stage === 'entering' && wanted) {
        changeStage('on');
        schedule();
      } else if (stage === 'leaving' && !wanted) {
        changeStage('off');
        setCaption(null);
      }
      if (values.mix >= 1 && next) {
        renderer?.promote();
        current = next;
        next = null;
        values.mix = 0;
        setFallback((shown) => (shown?.next ? { current: shown.next, next: null } : shown));
        setCaption(current);
        paint();
      }
    };
    const tick = (timestamp: number) => {
      frame = 0;
      if (disposed) return;
      for (const [key, tween] of tweens) {
        const t = Math.min(1, Math.max(0, (timestamp - tween.start) / tween.duration));
        values[key] = tween.from + (tween.to - tween.from) * tween.ease(t);
        if (t >= 1) tweens.delete(key);
      }
      paint();
      if (tweens.size > 0) frame = requestAnimationFrame(tick);
      else settle();
    };
    const run = () => {
      if (disposed) return;
      // Rien à animer (sans transition) : tout de suite, sans attendre la prochaine image.
      if (tweens.size === 0 && !frame) {
        paint();
        settle();
        return;
      }
      if (!frame) frame = requestAnimationFrame(tick);
    };

    const pick = (): ScreensaverImage | null => {
      if (images.length === 0) return null;
      if (bag.length === 0) bag = shuffle(images).filter((image) => image.id !== current?.id);
      return bag.shift() ?? images[0] ?? null;
    };
    const load = async (slot: ScreensaverSlot): Promise<ScreensaverImage | null> => {
      // Une image illisible est sautée ; au plus un tour complet de la liste.
      for (let attempt = 0; attempt < Math.max(1, images.length); attempt++) {
        const image = pick();
        if (!image) return null;
        try {
          if (renderer) {
            const bitmap = await loadBitmap(image);
            // L’image reste ouverte jusqu’à son envoi à la carte graphique ; le moteur la ferme.
            if (disposed) {
              bitmap.close();
              return null;
            }
            renderer.set(slot, bitmap);
          } else {
            await new Promise<void>((resolve, reject) => {
              const probe = new Image();
              probe.onload = () => resolve();
              probe.onerror = () => reject(new Error(image.url));
              probe.src = image.url;
            });
            setFallback((shown) =>
              slot === 'current'
                ? { current: image.url, next: null }
                : { current: shown?.current ?? image.url, next: image.url },
            );
          }
          return image;
        } catch {
          images = images.filter((candidate) => candidate.id !== image.id);
        }
      }
      return null;
    };
    const schedule = () => {
      if (slideshow) clearTimeout(slideshow);
      slideshow = null;
      if (stage !== 'on' || images.length < 2) return;
      slideshow = setTimeout(() => void advance(), interval);
    };
    const advance = async () => {
      if (loading || stage !== 'on') return schedule();
      loading = true;
      const image = await load('next').finally(() => (loading = false));
      if (!image || disposed) return schedule();
      next = image;
      values.mix = 0;
      animate('mix', 1, motion.matches ? 800 : CROSSFADE_MS, 0, easeInOut);
      run();
      schedule();
    };

    /**
     * Transition du prochain mouvement. Un mouvement qui en interrompt un autre (la personne
     * repart avant la fin) garde la même, pour repartir de l’image telle qu’elle est.
     */
    const chooseEffect = (fresh: boolean): 'none' | 'reduced' | ScreensaverEffect => {
      if (style === 'none') return 'none';
      if (motion.matches) return 'reduced';
      if (fresh)
        effect =
          style === 'random'
            ? SCREENSAVER_RANDOM_EFFECTS[
                Math.floor(Math.random() * SCREENSAVER_RANDOM_EFFECTS.length)
              ]!
            : style;
      return effect;
    };
    const enter = async () => {
      const fresh = stage === 'off';
      if (fresh) {
        if (loading) return;
        loading = true;
        const image = await load('current').finally(() => (loading = false));
        if (!image || disposed || !wanted) return;
        current = image;
        next = null;
        setCaption(image);
      }
      const kind = chooseEffect(fresh);
      // Départ : la toile repliée dans l’orbe endormie, grise (en noir pour le fondu) ; ou
      // rien, pour un fondu réduit ou sans transition.
      if (fresh)
        Object.assign(
          values,
          kind === 'reduced' || kind === 'none'
            ? { progress: 0, gray: 0, veil: kind === 'none' ? 1 : 0, mix: 0 }
            : { progress: 1, gray: kind === 'fade' ? 0 : 1, veil: 1, mix: 0 },
        );
      changeStage('entering');
      // Le retour prend 1,6 fois la durée de l’effet : la peinture s’installe sans hâte.
      const length = duration * 1.6;
      if (kind === 'none') {
        for (const key of ['progress', 'gray', 'veil'] as const)
          animate(key, key === 'veil' ? 1 : 0, 0);
      } else if (kind === 'reduced') {
        animate('progress', 0, 0);
        animate('gray', 0, 0);
        animate('veil', 1, 900);
      } else if (kind === 'fade') {
        animate('veil', 1, 0);
        animate('progress', 0, length, 0, easeInOut);
      } else {
        animate('veil', 1, 200);
        animate('progress', 0, length, 0, easeOut);
        animate('gray', 0, length * 0.75, length * 0.55, easeInOut);
      }
      run();
    };
    const leave = () => {
      if (slideshow) clearTimeout(slideshow);
      slideshow = null;
      const fresh = stage === 'on';
      changeStage('leaving');
      const kind = chooseEffect(fresh);
      if (kind === 'none') {
        animate('veil', 0, 0);
      } else if (kind === 'reduced') {
        animate('gray', 1, 250);
        animate('veil', 0, 500);
      } else if (kind === 'fade') {
        animate('progress', 1, duration, 0, easeInOut);
      } else {
        // La toile se grise d’un coup, puis l’orbe l’efface en accélérant, le tout dans la
        // durée réglée.
        animate('gray', 1, Math.min(280, duration * 0.28), 0, easeOut);
        animate(
          'progress',
          1,
          duration * 0.9,
          duration * 0.1,
          kind === 'vortex' ? easeIn : easeInOut,
        );
      }
      run();
    };

    engine.current = {
      wake(active) {
        wanted = active;
        if (active && (stage === 'off' || stage === 'leaving')) void enter();
        else if (!active && (stage === 'entering' || stage === 'on')) leave();
      },
      setImages(list) {
        images = list;
        bag = bag.filter((image) => list.some((candidate) => candidate.id === image.id));
        // L’image affichée a été retirée : passer à la suivante sans attendre.
        if (stage === 'on' && current && !list.some((image) => image.id === current!.id))
          void advance();
        else schedule();
        if (wanted && stage === 'off') void enter();
      },
      setInterval(ms) {
        interval = ms;
        schedule();
      },
      setTransition(value) {
        style = value;
      },
      setDuration(ms) {
        duration = ms;
      },
      setFit(value) {
        placement = value;
        if (stage !== 'off') paint();
      },
    };
    const resized = () => {
      if (stage !== 'off') paint();
    };
    addEventListener('resize', resized);
    return () => {
      disposed = true;
      engine.current = null;
      removeEventListener('resize', resized);
      cancelAnimationFrame(frame);
      if (slideshow) clearTimeout(slideshow);
      renderer?.dispose();
    };
    // intervalMs, transition, durationMs et fit ne sont lus qu’au départ ; les setters suivent.
  }, []);

  useEffect(() => {
    if (!revision) return void engine.current?.setImages([]);
    let cancelled = false;
    void api
      .screensaverImages()
      .then(({ images }) => !cancelled && engine.current?.setImages(images))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [revision]);
  useEffect(() => engine.current?.setInterval(intervalMs), [intervalMs]);
  useEffect(() => engine.current?.setTransition(transition), [transition]);
  useEffect(() => engine.current?.setDuration(durationMs), [durationMs]);
  useEffect(() => engine.current?.setFit(fit), [fit]);
  useEffect(() => engine.current?.wake(active), [active]);

  return (
    <div className="mirror-screensaver" data-scene={scene} data-fit={fit} aria-hidden="true">
      <canvas ref={canvasRef} hidden={fallback !== null} />
      {fallback && (
        <div ref={fallbackRef} className="mirror-screensaver-fallback">
          <img src={fallback.current} alt="" />
          {fallback.next && <img className="is-next" src={fallback.next} alt="" />}
        </div>
      )}
      {caption?.credit && (
        <p className="mirror-screensaver-caption" key={caption.id}>
          <span>{caption.title}</span>
          {caption.credit}
        </p>
      )}
    </div>
  );
}
