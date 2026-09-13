class SoundSystem {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;
  private volume: number = 0.5;
  private boostOsc: OscillatorNode | null = null;
  private boostGain: GainNode | null = null;
  private ambientOsc: OscillatorNode | null = null;
  private ambientGain: GainNode | null = null;
  private lastEatNoteIndex: number = 0;
  private lastEatTime: number = 0;

  // C major pentatonic scale frequencies for melodic eating
  private notes = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25, 783.99, 880.00, 1046.50];

  public init(): void {
    if (typeof window === 'undefined') return;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx && !this.ctx) {
        this.ctx = new AudioCtx();
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      this.initAmbient();
    } catch {
      // AudioContext not allowed before user interaction
    }
  }

  private initAmbient(): void {
    if (!this.ctx || this.ambientOsc) return;
    try {
      this.ambientOsc = this.ctx.createOscillator();
      this.ambientGain = this.ctx.createGain();

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(140, this.ctx.currentTime);

      this.ambientOsc.type = 'sawtooth';
      this.ambientOsc.frequency.setValueAtTime(55, this.ctx.currentTime); // Low A1 drone

      this.ambientGain.gain.setValueAtTime(this.isMuted ? 0 : this.volume * 0.03, this.ctx.currentTime);

      this.ambientOsc.connect(filter);
      filter.connect(this.ambientGain);
      this.ambientGain.connect(this.ctx.destination);

      this.ambientOsc.start();
    } catch {
      // Audio context might not be fully unlocked yet
    }
  }

  public setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (this.ambientGain && this.ctx) {
      this.ambientGain.gain.setValueAtTime(muted ? 0 : this.volume * 0.03, this.ctx.currentTime);
    }
    if (this.boostGain && this.ctx) {
      if (muted) {
        this.boostGain.gain.setValueAtTime(0, this.ctx.currentTime);
      }
    }
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  public setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.ambientGain && this.ctx && !this.isMuted) {
      this.ambientGain.gain.setValueAtTime(this.volume * 0.03, this.ctx.currentTime);
    }
  }

  public playEat(value: number = 1): void {
    if (this.isMuted || !this.ctx) return;
    try {
      const now = performance.now();
      if (now - this.lastEatTime < 350) {
        this.lastEatNoteIndex = (this.lastEatNoteIndex + 1) % this.notes.length;
      } else {
        this.lastEatNoteIndex = Math.min(value, 3);
      }
      this.lastEatTime = now;

      const freq = this.notes[this.lastEatNoteIndex];
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.5, this.ctx.currentTime + 0.08);

      const peakGain = Math.min(0.2, 0.06 + value * 0.015) * this.volume;
      gain.gain.setValueAtTime(peakGain, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.1);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.1);
    } catch {
      // Audio context may be closed or locked
    }
  }

  public setBoosting(boosting: boolean): void {
    if (this.isMuted || !this.ctx) {
      if (this.boostGain && this.ctx) {
        this.boostGain.gain.setValueAtTime(0, this.ctx.currentTime);
      }
      return;
    }

    try {
      if (!this.boostOsc) {
        this.boostOsc = this.ctx.createOscillator();
        this.boostGain = this.ctx.createGain();

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(220, this.ctx.currentTime);
        filter.Q.setValueAtTime(3, this.ctx.currentTime);

        this.boostOsc.type = 'sawtooth';
        this.boostOsc.frequency.setValueAtTime(110, this.ctx.currentTime);

        this.boostGain.gain.setValueAtTime(0, this.ctx.currentTime);

        this.boostOsc.connect(filter);
        filter.connect(this.boostGain);
        this.boostGain.connect(this.ctx.destination);

        this.boostOsc.start();
      }

      if (this.boostGain && this.boostOsc) {
        const targetGain = boosting && !this.isMuted ? this.volume * 0.12 : 0.0001;
        this.boostGain.gain.cancelScheduledValues(this.ctx.currentTime);
        this.boostGain.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.08);

        if (boosting) {
          this.boostOsc.frequency.setTargetAtTime(160, this.ctx.currentTime, 0.15);
        } else {
          this.boostOsc.frequency.setTargetAtTime(100, this.ctx.currentTime, 0.1);
        }
      }
    } catch {
      // Ignore audio resume errors
    }
  }

  public playKill(): void {
    if (this.isMuted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;

      // Sub-bass impact
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.exponentialRampToValueAtTime(30, now + 0.4);

      gain.gain.setValueAtTime(this.volume * 0.4, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.45);

      // Noise explosion burst
      const bufferSize = this.ctx.sampleRate * 0.35;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(800, now);
      filter.frequency.exponentialRampToValueAtTime(80, now + 0.35);

      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(this.volume * 0.35, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      noise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(this.ctx.destination);

      noise.start(now);
    } catch {
      // Ignore
    }
  }

  public playDeath(): void {
    if (this.isMuted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      this.setBoosting(false);

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(280, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.6);

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1200, now);
      filter.frequency.exponentialRampToValueAtTime(100, now + 0.6);

      gain.gain.setValueAtTime(this.volume * 0.45, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.65);
    } catch {
      // Ignore
    }
  }
}

export const sound = new SoundSystem();
