/** Tiny, self-contained Web Audio instrument. No remote requests or audio files. */
export class GameAudio {
  private context?: AudioContext;
  muted = false;

  unlock() {
    if (this.muted) return;
    try {
      this.context ??= new AudioContext();
      if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
    } catch {
      // The game remains fully playable if audio is unavailable.
    }
  }

  private note(frequency: number, delay = 0, duration = 0.2, volume = 0.06, type: OscillatorType = 'sine') {
    if (this.muted || !this.context || this.context.state !== 'running') return;
    const ctx = this.context;
    const t = ctx.currentTime + delay;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, t);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(t);
    oscillator.stop(t + duration + 0.01);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  }

  drop() { this.note(280, 0, 0.09, 0.035, 'triangle'); }

  merge(level: number, combo: number) {
    const pitch = 440 * 2 ** (Math.min(18, level + (combo - 1) * 2) / 12);
    this.note(pitch, 0, 0.22, 0.06, 'triangle');
    this.note(pitch * 1.25, 0.055, 0.25, 0.04);
    this.note(pitch * 1.5, 0.11, 0.3, 0.035);
  }

  crown() {
    [0, 4, 7, 12, 7, 12, 16, 19].forEach((n, i) =>
      this.note(523.25 * 2 ** (n / 12), i * 0.1, 0.42, 0.045, 'triangle'));
  }

  gameover() {
    [392, 349.23, 293.66, 261.63].forEach((n, i) => this.note(n, i * 0.13, 0.35, 0.04));
  }

  destroy() { void this.context?.close().catch(() => {}); }
}
