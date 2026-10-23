import { GAME, LEVELS } from './config';
import { PhysicsGame } from './physics';
import { GameAudio } from './audio';
import type { GameState, PhysicsEvent } from './types';

interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; size: number; color: string; star: boolean; ring: boolean;
}
interface Burst {
  x: number; y: number; age: number; radius: number; color: string; text: string;
  combo: number; intensity: number; duration: number;
}
interface PieceMotion { age: number; kind: 'drop' | 'merge'; }
interface Celebration { level: number; remaining: number; duration: number; }
interface ArtBounds { x: number; y: number; width: number; height: number; }

const BEST_KEY = 'merge-big-gpt.best.v1';
const SOUND_KEY = 'merge-big-gpt.muted.v1';
const STEP = 1000 / 60;
const MAX_PARTICLES = 200;
const MAX_BURSTS = 18;
const SPRITE_DPR = 2;
const CANDY_RIMS = ['#87baa6', '#b59bd6', '#e6ad9e', '#8cbdb2', '#9eaddb', '#d8a0ba', '#d9b874', '#8ebdc9', '#a5b890', '#c09fd3', '#d3b16b'];
const COMBO_COLORS = ['#ba9bd7', '#e4a4c1', '#e8ac83', '#d8b45f', '#a58bd6'];
// Framing is a render concern: silhouettes stay diverse while small faces gain
// room. The final art is always clipped to its true physical circle.
const ART_FRAMES = [
  { scale: 0.94, y: 0 }, { scale: 1.06, y: -0.10 }, { scale: 1.02, y: -0.06 },
  { scale: 1.02, y: -0.03 }, { scale: 1.02, y: -0.04 }, { scale: 1.02, y: -0.04 },
  { scale: 0.96, y: -0.02 }, { scale: 0.96, y: -0.04 }, { scale: 0.98, y: 0 },
  { scale: 0.96, y: 0 }, { scale: 0.94, y: 0 },
];
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function loadBest(): number {
  try {
    const value = Number(localStorage.getItem(BEST_KEY));
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  } catch { return 0; }
}
function persist(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* Private mode can disable storage. */ }
}

export class Game {
  readonly physics: PhysicsGame;
  private ctx: CanvasRenderingContext2D;
  private audio = new GameAudio();
  private best = loadBest();
  private images: HTMLImageElement[];
  private sprites: Array<HTMLCanvasElement | undefined> = [];
  private artBounds = new WeakMap<HTMLImageElement, ArtBounds>();
  private background?: HTMLCanvasElement;
  private particles: Particle[] = [];
  private bursts: Burst[] = [];
  private pieceMotions = new Map<number, PieceMotion>();
  private celebration?: Celebration;
  private frame = 0;
  private lastTime = 0;
  private accumulator = 0;
  private lastNotify = '';
  private keys = new Set<string>();
  private activePointer: number | null = null;
  private crownTime = 0;
  private crownPosition = { x: GAME.width / 2, y: GAME.height / 2 };
  private disposed = false;
  private resizeObserver: ResizeObserver;
  private abort = new AbortController();
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor(
    private canvas: HTMLCanvasElement,
    private onChange: (state: GameState) => void,
    private onEvent: (event: PhysicsEvent) => void = () => {},
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('此浏览器不支持 Canvas 2D，请尝试现代浏览器。');
    this.ctx = ctx;
    try { this.audio.muted = localStorage.getItem(SOUND_KEY) === 'true'; } catch { /* Optional storage. */ }
    this.images = LEVELS.map((level, index) => {
      const img = new Image();
      img.onload = () => {
        if (!this.disposed) this.sprites[index] = this.createBubbleSprite(index);
      };
      img.src = level.image;
      return img;
    });
    this.physics = new PhysicsGame(event => this.handleEvent(event));
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    this.bindInput();
    this.frame = requestAnimationFrame(time => this.tick(time));
  }

  snapshot(): GameState {
    const state = this.physics.snapshot();
    if (state.score > this.best) {
      this.best = state.score;
      persist(BEST_KEY, String(this.best));
    }
    return { ...state, best: this.best, muted: this.audio.muted };
  }

  pause() {
    this.physics.pause();
    this.keys.clear();
    this.activePointer = null;
    this.accumulator = 0;
    this.notify();
  }

  resume() {
    this.physics.resume();
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.notify();
  }

  restart() {
    this.physics.reset();
    this.particles.length = 0;
    this.bursts.length = 0;
    this.pieceMotions.clear();
    this.celebration = undefined;
    this.crownTime = 0;
    this.accumulator = 0;
    this.keys.clear();
    this.activePointer = null;
    this.lastTime = performance.now();
    this.notify();
  }

  toggleMute() {
    this.audio.muted = !this.audio.muted;
    persist(SOUND_KEY, String(this.audio.muted));
    if (!this.audio.muted) this.audio.unlock();
    this.notify();
  }

  destroy() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.abort.abort();
    this.audio.destroy();
    this.physics.destroy();
    this.particles.length = 0;
    this.bursts.length = 0;
    this.pieceMotions.clear();
    this.celebration = undefined;
    this.background = undefined;
    this.sprites.length = 0;
    for (const img of this.images) img.onload = null;
    this.images.length = 0;
  }

  private resize() {
    const width = this.canvas.getBoundingClientRect().width || GAME.width;
    const scale = Math.min(window.devicePixelRatio || 1, 2) * width / GAME.width;
    this.canvas.width = Math.round(GAME.width * scale);
    this.canvas.height = Math.round(GAME.height * scale);
    this.ctx.setTransform(this.canvas.width / GAME.width, 0, 0, this.canvas.height / GAME.height, 0, 0);
    this.background ??= this.createBackground();
    this.draw();
  }

  private bindInput() {
    const opts = { signal: this.abort.signal };
    const aim = (event: PointerEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      this.physics.aim((event.clientX - rect.left) / rect.width * GAME.width);
    };
    this.canvas.addEventListener('pointermove', event => {
      if (event.pointerType === 'mouse' || event.pointerId === this.activePointer) aim(event);
    }, opts);
    this.canvas.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.button !== 0 || this.activePointer !== null) return;
      if (this.physics.snapshot().status !== 'playing') return;
      event.preventDefault();
      this.canvas.focus({ preventScroll: true });
      this.audio.unlock();
      this.activePointer = event.pointerId;
      this.canvas.setPointerCapture(event.pointerId);
      aim(event);
    }, opts);
    this.canvas.addEventListener('pointerup', event => {
      if (event.pointerId !== this.activePointer) return;
      event.preventDefault();
      aim(event);
      this.activePointer = null;
      if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
      this.physics.drop();
      this.notify();
    }, opts);
    const cancel = () => { this.activePointer = null; };
    this.canvas.addEventListener('pointercancel', cancel, opts);
    this.canvas.addEventListener('lostpointercapture', cancel, opts);
    this.canvas.addEventListener('contextmenu', event => event.preventDefault(), opts);
    window.addEventListener('keydown', event => {
      if (event.ctrlKey || event.metaKey || event.altKey || document.querySelector('dialog[open]')) return;
      const tag = (event.target as HTMLElement)?.tagName;
      if (tag !== 'BODY' && event.target !== this.canvas) return;
      if (['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD'].includes(event.code)) {
        event.preventDefault();
        this.keys.add(event.code);
      }
      if (['Space', 'ArrowDown'].includes(event.code)) {
        event.preventDefault();
        if (!event.repeat) {
          this.audio.unlock();
          this.physics.drop();
          this.notify();
        }
      }
      if (event.code === 'KeyP' && !event.repeat) {
        event.preventDefault();
        this.physics.snapshot().status === 'playing' ? this.pause() : this.resume();
      }
    }, opts);
    window.addEventListener('keyup', event => this.keys.delete(event.code), opts);
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.activePointer = null;
      // A browser losing focus must never continue playing behind another app.
      this.pause();
    }, opts);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
    }, opts);
    window.addEventListener('storage', event => {
      if (event.key === BEST_KEY) {
        this.best = Math.max(this.best, loadBest());
        this.notify();
      }
    }, opts);
  }

  private notify() {
    const state = this.snapshot();
    // Physics time and pointer position do not require rebuilding the HTML UI.
    const key = JSON.stringify({ ...state, time: 0, aimX: 0, warning: Math.round(state.warning * 20) / 20 });
    if (key !== this.lastNotify) {
      this.lastNotify = key;
      this.onChange(state);
    }
  }

  private handleEvent(event: PhysicsEvent) {
    if (event.type === 'drop') {
      this.audio.drop();
      this.markPieceMotion(event.level, event.x, event.y, 'drop');
    }
    if (event.type === 'merge') {
      const level = LEVELS[event.level];
      const intensity = Math.min(5, Math.max(1, event.combo));
      const color = COMBO_COLORS[intensity - 1];
      this.audio.merge(event.level, event.combo);
      this.markPieceMotion(event.level, event.x, event.y, 'merge');
      this.bursts.push({
        x: event.x, y: event.y, age: 0, radius: level.radius, color, text: `+${event.points}`,
        combo: event.combo, intensity, duration: this.reducedMotion.matches ? 650 : 850 + intensity * 45,
      });
      if (this.bursts.length > MAX_BURSTS) this.bursts.splice(0, this.bursts.length - MAX_BURSTS);
      this.emitParticles(event.x, event.y, color, this.reducedMotion.matches ? 4 : 12 + intensity * 6, intensity);
      if (level.id >= 8 && level.id < 11 && this.crownTime <= 0) {
        this.celebration = { level: event.level, remaining: 1900, duration: 1900 };
        if (!this.reducedMotion.matches) this.emitParticles(event.x, event.y, '#e6bd78', 26, 3);
      }
    }
    if (event.type === 'crown') {
      this.audio.crown();
      this.crownTime = 4200;
      this.celebration = undefined;
      this.crownPosition = { x: event.x, y: event.y };
      if (!this.reducedMotion.matches) {
        this.emitParticles(event.x, event.y, '#e6b84d', 80, 5);
        this.emitParticles(GAME.width / 2, 60, '#e8b6ce', 44, 4);
      }
    }
    if (event.type === 'gameover') this.audio.gameover();
    this.onEvent(event);
  }

  private markPieceMotion(level: number, x: number, y: number, kind: PieceMotion['kind']) {
    let closestId: number | undefined;
    let distance = Infinity;
    for (const piece of this.physics.pieces.values()) {
      if (piece.level !== level) continue;
      const nextDistance = (piece.body.position.x - x) ** 2 + (piece.body.position.y - y) ** 2;
      if (nextDistance < distance) { distance = nextDistance; closestId = piece.body.id; }
    }
    if (closestId !== undefined) this.pieceMotions.set(closestId, { age: 0, kind });
  }

  private emitParticles(x: number, y: number, color: string, count: number, intensity = 1) {
    const reduced = this.reducedMotion.matches;
    const palette = [color, '#f1c7dc', '#ead28f', '#ffffff', '#c7b3e7'];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = reduced ? 0 : 35 + Math.random() * (90 + intensity * 28);
      const life = reduced ? 450 : 450 + Math.random() * 650;
      this.particles.push({
        x: x + (reduced ? Math.cos(angle) * 18 : 0), y: y + (reduced ? Math.sin(angle) * 18 : 0),
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - (reduced ? 0 : 65),
        life, maxLife: life, size: 2 + Math.random() * 5,
        color: palette[i % palette.length], star: i % 3 === 0, ring: i % 5 === 0,
      });
    }
    if (this.particles.length > MAX_PARTICLES) this.particles.splice(0, this.particles.length - MAX_PARTICLES);
  }

  private tick(time: number) {
    if (this.disposed) return;
    const delta = this.lastTime ? Math.min(100, Math.max(0, time - this.lastTime)) : 0;
    this.lastTime = time;
    if (this.physics.snapshot().status === 'playing') {
      this.accumulator = Math.min(this.accumulator + delta, STEP * 6);
      while (this.accumulator >= STEP) {
        const state = this.physics.snapshot();
        const direction = Number(this.keys.has('ArrowRight') || this.keys.has('KeyD'))
          - Number(this.keys.has('ArrowLeft') || this.keys.has('KeyA'));
        if (direction) this.physics.aim(state.aimX + direction * STEP * 0.3);
        this.physics.step(STEP);
        this.advanceEffects(STEP);
        this.accumulator -= STEP;
        if (this.physics.snapshot().status !== 'playing') { this.accumulator = 0; break; }
      }
    } else {
      this.accumulator = 0;
    }
    this.notify();
    this.draw();
    this.frame = requestAnimationFrame(nextTime => this.tick(nextTime));
  }

  private advanceEffects(delta: number) {
    this.crownTime = Math.max(0, this.crownTime - delta);
    if (this.celebration) {
      this.celebration.remaining -= delta;
      if (this.celebration.remaining <= 0) this.celebration = undefined;
    }
    for (const [id, motion] of this.pieceMotions) {
      motion.age += delta;
      if (motion.age > 650 || !this.physics.pieces.has(id)) this.pieceMotions.delete(id);
    }
    for (const particle of this.particles) {
      particle.life -= delta;
      if (!this.reducedMotion.matches) {
        particle.x += particle.vx * delta / 1000;
        particle.y += particle.vy * delta / 1000;
        particle.vy += 180 * delta / 1000;
      }
    }
    this.particles = this.particles.filter(particle => particle.life > 0);
    for (const burst of this.bursts) burst.age += delta;
    this.bursts = this.bursts.filter(burst => burst.age < burst.duration);
  }

  /** Measure transparent padding once at load time; source PNGs stay untouched. */
  private getArtBounds(img: HTMLImageElement): ArtBounds {
    const cached = this.artBounds.get(img);
    if (cached) return cached;
    const bounds = { x: 0, y: 0, width: img.naturalWidth, height: img.naturalHeight };
    const sample = document.createElement('canvas');
    const ratio = 192 / Math.max(img.naturalWidth, img.naturalHeight);
    sample.width = Math.max(1, Math.round(img.naturalWidth * ratio));
    sample.height = Math.max(1, Math.round(img.naturalHeight * ratio));
    const ctx = sample.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      ctx.drawImage(img, 0, 0, sample.width, sample.height);
      try {
        const pixels = ctx.getImageData(0, 0, sample.width, sample.height).data;
        let minX = sample.width, minY = sample.height, maxX = -1, maxY = -1;
        for (let y = 0; y < sample.height; y++) {
          for (let x = 0; x < sample.width; x++) {
            if (pixels[(y * sample.width + x) * 4 + 3] <= 24) continue;
            minX = Math.min(minX, x); minY = Math.min(minY, y);
            maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
          }
        }
        if (maxX >= minX && maxY >= minY) {
          const left = Math.max(0, minX - 1), top = Math.max(0, minY - 1);
          bounds.x = left / sample.width * img.naturalWidth;
          bounds.y = top / sample.height * img.naturalHeight;
          bounds.width = (Math.min(sample.width, maxX + 2) - left) / sample.width * img.naturalWidth;
          bounds.height = (Math.min(sample.height, maxY + 2) - top) / sample.height * img.naturalHeight;
        }
      } catch { /* A future remote asset can still render without alpha sampling. */ }
    }
    this.artBounds.set(img, bounds);
    return bounds;
  }

  private createBubbleSprite(level: number): HTMLCanvasElement {
    const radius = LEVELS[level].radius;
    const sprite = document.createElement('canvas');
    const diameter = Math.ceil(radius * 2 * SPRITE_DPR);
    sprite.width = diameter;
    sprite.height = diameter;
    const ctx = sprite.getContext('2d')!;
    ctx.setTransform(SPRITE_DPR, 0, 0, SPRITE_DPR, diameter / 2, diameter / 2);
    const rim = CANDY_RIMS[level];
    const edge = Math.max(2, Math.min(5.2, radius * 0.065));
    const circle = (r: number) => { ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); };
    circle(radius - 0.5);
    ctx.clip();

    // Light transmission stays mostly white; the saturated candy tint lives on
    // the shell only, so white hair and pearl-white tails never turn purple.
    const glass = ctx.createRadialGradient(-radius * 0.3, -radius * 0.4, 0, 0, 0, radius);
    glass.addColorStop(0, '#ffffffed');
    glass.addColorStop(0.64, '#fffdfbd9');
    glass.addColorStop(1, `${rim}75`);
    ctx.fillStyle = glass;
    ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
    ctx.beginPath();
    ctx.ellipse(0, radius * 0.70, radius * 0.65, radius * 0.15, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#8570901c';
    ctx.fill();

    const img = this.images[level];
    if (img?.complete && img.naturalWidth > 0) {
      const frame = ART_FRAMES[level];
      const bounds = this.getArtBounds(img);
      const scale = radius * 2 * frame.scale / Math.max(bounds.width, bounds.height);
      const width = bounds.width * scale, height = bounds.height * scale;
      ctx.save();
      circle(radius - edge * 0.75);
      ctx.clip();
      ctx.drawImage(img, bounds.x, bounds.y, bounds.width, bounds.height, -width / 2, -height / 2 + radius * frame.y, width, height);
      ctx.restore();
    } else {
      ctx.fillStyle = '#87708e';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `800 ${Math.max(14, radius * 0.75)}px sans-serif`;
      ctx.fillText(String(level + 1), 0, 0);
    }

    // Soft bottom refraction and three nested strokes give a thick glass shell
    // without per-frame blur filters or color overlays on the character's face.
    ctx.beginPath();
    ctx.arc(0, 0, radius - edge * 1.05, 0.17 * Math.PI, 0.83 * Math.PI);
    ctx.strokeStyle = `${rim}78`;
    ctx.lineWidth = edge * 1.15;
    ctx.lineCap = 'round';
    ctx.stroke();
    circle(radius - edge / 2 - 0.5);
    ctx.lineWidth = edge;
    const shell = ctx.createLinearGradient(-radius, -radius, radius, radius);
    shell.addColorStop(0, '#ffffff');
    shell.addColorStop(0.35, rim);
    shell.addColorStop(0.70, `${rim}df`);
    shell.addColorStop(1, '#fef9ff');
    ctx.strokeStyle = shell;
    ctx.stroke();
    circle(radius - edge - 0.5);
    ctx.lineWidth = Math.max(0.9, radius * 0.014);
    ctx.strokeStyle = '#ffffffd9';
    ctx.stroke();
    circle(radius - 0.65);
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = `${rim}d9`;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, radius - edge * 0.85, Math.PI * 1.08, Math.PI * 1.42);
    ctx.lineWidth = Math.max(1.8, radius * 0.045);
    ctx.strokeStyle = '#ffffffed';
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(-radius * 0.45, -radius * 0.58, radius * 0.12, radius * 0.055, -0.65, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffffc9';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(radius * 0.48, radius * 0.62, Math.max(1, radius * 0.035), 0, Math.PI * 2);
    ctx.fillStyle = '#ffffffcf';
    ctx.fill();
    return sprite;
  }

  private drawCharacter(level: number, x: number, y: number, radius: number, angle = 0, alpha = 1, motion?: PieceMotion) {
    const ctx = this.ctx;
    const sprite = this.sprites[level] ??= this.createBubbleSprite(level);
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.translate(x, y);
    // All pop/squash transforms are visual and clipped to the immutable circle.
    ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.clip();
    if (!this.reducedMotion.matches) {
      ctx.rotate(Math.sin(angle) * 0.14);
      if (motion) {
        const damping = Math.exp(-motion.age / 135);
        const pulse = Math.sin(motion.age / 33) * damping;
        const pop = motion.kind === 'merge' ? 1 - 0.17 * damping * (0.5 + 0.5 * Math.cos(motion.age / 38)) : 1;
        ctx.scale(Math.min(1, pop + pulse * 0.055), Math.min(1, pop - pulse * 0.06));
      }
    }
    ctx.drawImage(sprite, -radius, -radius, radius * 2, radius * 2);
    ctx.restore();
  }

  private createBackground(): HTMLCanvasElement {
    const background = document.createElement('canvas');
    background.width = GAME.width * SPRITE_DPR;
    background.height = GAME.height * SPRITE_DPR;
    const ctx = background.getContext('2d')!;
    ctx.scale(SPRITE_DPR, SPRITE_DPR);
    const cream = ctx.createLinearGradient(0, 0, 0, GAME.height);
    cream.addColorStop(0, '#fffdf9');
    cream.addColorStop(0.47, '#fff9fa');
    cream.addColorStop(1, '#f6f0fc');
    ctx.fillStyle = cream;
    ctx.fillRect(0, 0, GAME.width, GAME.height);
    const glow = ctx.createRadialGradient(210, 200, 25, 210, 240, 330);
    glow.addColorStop(0, '#ffffffb3'); glow.addColorStop(1, '#ffffff00');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, GAME.width, GAME.height);

    ctx.strokeStyle = '#d9c9e31c';
    ctx.lineWidth = 1;
    for (let y = 160; y < GAME.floorY; y += 30) {
      ctx.beginPath(); ctx.moveTo(GAME.wall, y); ctx.lineTo(GAME.width - GAME.wall, y); ctx.stroke();
    }
    for (let x = 25; x < GAME.width - 12; x += 30) {
      for (let y = 151; y < GAME.floorY - 10; y += 30) {
        ctx.beginPath(); ctx.arc(x, y, 0.9, 0, Math.PI * 2);
        ctx.fillStyle = (x + y) % 2 ? '#dec6d83b' : '#d0c2e13b'; ctx.fill();
      }
    }
    // Tiny sugar sprinkles stay near the sides, away from busy gameplay.
    for (const [x, y, angle] of [[31, 204, -0.4], [408, 259, 0.5], [26, 366, 0.6], [410, 458, -0.7], [33, 540, 0.3]]) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
      ctx.fillStyle = '#e5ccd84d'; ctx.beginPath(); ctx.roundRect(-3, -1, 6, 2, 1); ctx.fill();
      ctx.restore();
    }
    for (const x of [0, GAME.width - GAME.wall]) {
      const rail = ctx.createLinearGradient(x, 0, x + GAME.wall, 0);
      rail.addColorStop(0, '#eddce8'); rail.addColorStop(0.45, '#fffaff'); rail.addColorStop(1, '#d9c6df');
      ctx.fillStyle = rail; ctx.fillRect(x, GAME.deadline + 11, GAME.wall, GAME.floorY - GAME.deadline - 11);
    }
    ctx.strokeStyle = '#c8afd0'; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(GAME.wall, GAME.deadline + 11); ctx.lineTo(GAME.wall, GAME.floorY);
    ctx.lineTo(GAME.width - GAME.wall, GAME.floorY); ctx.lineTo(GAME.width - GAME.wall, GAME.deadline + 11); ctx.stroke();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(GAME.wall - 3, GAME.deadline + 16); ctx.lineTo(GAME.wall - 3, GAME.floorY);
    ctx.moveTo(GAME.width - GAME.wall + 3, GAME.deadline + 16); ctx.lineTo(GAME.width - GAME.wall + 3, GAME.floorY); ctx.stroke();

    const floor = ctx.createLinearGradient(0, GAME.floorY, 0, GAME.height);
    floor.addColorStop(0, '#dac2e0'); floor.addColorStop(0.20, '#fef7ff'); floor.addColorStop(0.55, '#e9d7ec'); floor.addColorStop(1, '#d6bedc');
    ctx.fillStyle = floor; ctx.fillRect(0, GAME.floorY, GAME.width, GAME.height - GAME.floorY);
    ctx.fillStyle = '#bca2c42b'; ctx.fillRect(GAME.wall, GAME.floorY - 4, GAME.width - GAME.wall * 2, 4);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(GAME.wall, GAME.floorY + 2, GAME.width - GAME.wall * 2, 1.2);
    return background;
  }

  private star(x: number, y: number, radius: number, color: string, rotation = 0) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const angle = Math.PI * i / 4;
      const r = i % 2 ? radius * 0.3 : radius;
      const px = Math.cos(angle) * r, py = Math.sin(angle) * r;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  private draw() {
    if (!this.physics) return;
    const ctx = this.ctx;
    const state = this.physics.snapshot();
    ctx.clearRect(0, 0, GAME.width, GAME.height);
    this.background ??= this.createBackground();
    ctx.drawImage(this.background, 0, 0, GAME.width, GAME.height);

    ctx.save();
    ctx.setLineDash([4, 7]);
    ctx.strokeStyle = state.warning > 0 ? '#de8d9b' : '#cbb1d4';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(GAME.wall + 10, GAME.deadline);
    ctx.lineTo(GAME.width - GAME.wall - 10, GAME.deadline);
    ctx.stroke();
    ctx.restore();
    ctx.font = '12px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = state.warning > 0 ? '#a74860' : '#867091';
    ctx.fillText(state.warning > 0 ? '整颗越线才判负' : '上下文警戒线', 24, GAME.deadline - 10);
    if (state.warning > 0) {
      ctx.fillStyle = `rgba(227, 129, 143, ${0.035 + state.warning * 0.07})`;
      ctx.fillRect(0, GAME.deadline, GAME.width, 60);
      ctx.fillStyle = '#d89299';
      ctx.fillRect(20, GAME.deadline + 8, (GAME.width - 40) * state.warning, 3);
    }

    if (this.physics.pieces.size === 0 && state.drops === 0) {
      ctx.save();
      ctx.globalAlpha = 1;
      this.star(157, 278, 10, '#c8b2dc', 0.2);
      this.star(292, 308, 7, '#bacdb0', 0.2);
      this.drawCharacter(1, GAME.width / 2, 293, 42, -0.08, 0.8);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#705380';
      ctx.font = '600 17px "Microsoft YaHei", sans-serif';
      ctx.fillText('投下一点灵感', GAME.width / 2, 366);
      ctx.fillStyle = '#8b7597';
      ctx.font = '12px "Microsoft YaHei", sans-serif';
      ctx.fillText('相同的龙娘碰在一起，就会长大哦', GAME.width / 2, 393);
      ctx.restore();
    }

    if (this.crownTime > 0) {
      ctx.save();
      const alpha = Math.min(this.crownTime / 900, 1) * (this.reducedMotion.matches ? 0.065 : 0.14);
      ctx.globalAlpha = alpha;
      ctx.translate(this.crownPosition.x, this.crownPosition.y);
      if (!this.reducedMotion.matches) ctx.rotate(state.time / 5000);
      for (let i = 0; i < 12; i++) {
        ctx.rotate(Math.PI / 6);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-65, -750); ctx.lineTo(65, -750);
        ctx.closePath(); ctx.fillStyle = i % 2 ? '#dec2f4' : '#f5cc67'; ctx.fill();
      }
      ctx.restore();
    }

    for (const piece of this.physics.pieces.values()) {
      const { x, y } = piece.body.position;
      const radius = LEVELS[piece.level].radius;
      this.drawCharacter(piece.level, x, y, radius, piece.body.angle, 1, this.pieceMotions.get(piece.body.id));
    }

    if (state.status !== 'gameover') {
      const radius = LEVELS[state.currentLevel].radius;
      let landingY = GAME.floorY - radius;
      for (const piece of this.physics.pieces.values()) {
        const dx = Math.abs(piece.body.position.x - state.aimX);
        const separation = radius + LEVELS[piece.level].radius;
        if (dx < separation) {
          const top = piece.body.position.y - Math.sqrt(separation * separation - dx * dx);
          if (top >= GAME.spawnY) landingY = Math.min(landingY, top);
        }
      }
      ctx.save();
      ctx.strokeStyle = '#bda7d580';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 6]);
      ctx.beginPath();
      ctx.moveTo(state.aimX, GAME.spawnY + radius + 9);
      ctx.lineTo(state.aimX, Math.max(GAME.spawnY + radius + 9, landingY - radius));
      ctx.stroke();
      ctx.setLineDash([]);
      if (state.canDrop && landingY > GAME.deadline) {
        ctx.beginPath(); ctx.ellipse(state.aimX, landingY + radius - 2, radius * 0.7, 3, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#c9b4dd55'; ctx.fill();
      }
      ctx.restore();
      this.drawCharacter(state.currentLevel, state.aimX, GAME.spawnY, radius, 0, state.canDrop ? 1 : 0.38);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#7c608f';
      ctx.font = '12px "Microsoft YaHei", sans-serif';
      ctx.fillText(state.canDrop ? '↓ 松手投放' : '灵感装填中…', state.aimX, GAME.spawnY + radius + 19);
    }

    for (const burst of this.bursts) {
      const progress = clamp(burst.age / burst.duration, 0, 1);
      const travel = this.reducedMotion.matches ? 0 : burst.age * 0.037;
      const expansion = this.reducedMotion.matches ? 5 : burst.age * (0.025 + burst.intensity * 0.006);
      ctx.save();
      ctx.globalAlpha = (1 - progress) ** 1.3;
      ctx.strokeStyle = burst.color;
      ctx.lineWidth = 1.5 + burst.intensity * 0.4;
      ctx.beginPath();
      ctx.arc(burst.x, burst.y, burst.radius + expansion, 0, Math.PI * 2);
      ctx.stroke();
      if (burst.intensity >= 3 && !this.reducedMotion.matches) {
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = '#fffef8';
        ctx.beginPath(); ctx.arc(burst.x, burst.y, burst.radius + expansion * 0.65, 0, Math.PI * 2); ctx.stroke();
      }
      const textX = clamp(burst.x, 44, GAME.width - 44);
      const textY = Math.max(GAME.deadline + 28, burst.y - burst.radius - travel);
      ctx.textAlign = 'center';
      ctx.font = `800 ${20 + Math.min(4, burst.intensity)}px "Microsoft YaHei", sans-serif`;
      ctx.strokeStyle = '#fffdf8';
      ctx.lineWidth = 5;
      ctx.lineJoin = 'round';
      ctx.strokeText(burst.text, textX, textY);
      ctx.fillStyle = burst.color;
      ctx.fillText(burst.text, textX, textY);
      if (burst.combo > 1) {
        ctx.font = '800 12px "Microsoft YaHei", sans-serif';
        ctx.lineWidth = 4;
        ctx.strokeText(`COMBO ×${burst.combo}`, textX, textY - 24);
        ctx.fillStyle = burst.intensity >= 4 ? '#bb8c3f' : '#b57aa0';
        ctx.fillText(`COMBO ×${burst.combo}`, textX, textY - 24);
      }
      ctx.restore();
    }
    for (const particle of this.particles) {
      ctx.save();
      ctx.globalAlpha = clamp(particle.life / Math.min(particle.maxLife, 300), 0, 1);
      if (particle.ring) {
        ctx.beginPath(); ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        ctx.strokeStyle = particle.color; ctx.lineWidth = 1.4; ctx.stroke();
        ctx.beginPath(); ctx.arc(particle.x - particle.size * 0.3, particle.y - particle.size * 0.35, 0.9, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff'; ctx.fill();
      } else if (particle.star) this.star(particle.x, particle.y, particle.size, particle.color, this.reducedMotion.matches ? 0 : particle.life / 250);
      else {
        ctx.fillStyle = particle.color;
        ctx.beginPath(); ctx.arc(particle.x, particle.y, particle.size * 0.6, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
    if (this.celebration && this.crownTime <= 0) {
      const celebration = this.celebration;
      const level = LEVELS[celebration.level];
      const age = celebration.duration - celebration.remaining;
      const alpha = Math.min(1, age / 120, celebration.remaining / 400);
      const y = 162 + (this.reducedMotion.matches ? 0 : Math.max(0, 1 - age / 220) * 10);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#fff9f7f2';
      ctx.beginPath(); ctx.roundRect(58, y, GAME.width - 116, 54, 17); ctx.fill();
      ctx.strokeStyle = '#e4c5d7'; ctx.lineWidth = 1.5; ctx.stroke();
      this.star(82, y + 27, 7, '#dfbd79');
      this.star(GAME.width - 82, y + 27, 7, '#cbb0df');
      ctx.textAlign = 'center';
      ctx.font = '800 16px "Microsoft YaHei", sans-serif';
      ctx.fillStyle = '#98709f';
      ctx.fillText(`Lv.${level.id} · ${level.name}`, GAME.width / 2, y + 24);
      ctx.font = '11px "Microsoft YaHei", sans-serif';
      ctx.fillStyle = '#b49baf';
      ctx.fillText('叮！今天的灵感，闪闪发光', GAME.width / 2, y + 42);
      ctx.restore();
    }
    if (this.crownTime > 0) {
      ctx.save();
      ctx.globalAlpha = clamp(this.crownTime / 700, 0, 1);
      ctx.fillStyle = '#fff9e9ed';
      ctx.beginPath(); ctx.roundRect(38, 162, GAME.width - 76, 64, 16); ctx.fill();
      ctx.strokeStyle = '#e4c870'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#9b782f';
      ctx.font = '700 17px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('伟大的 GPT 龙娘大人，降临！', GAME.width / 2, 190);
      ctx.font = '11px "Microsoft YaHei", sans-serif';
      ctx.fillText('这一刻，算力为你闪耀。', GAME.width / 2, 211);
      ctx.restore();
    }
  }
}
