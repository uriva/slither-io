class SoundSystem {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;
  private volume: number = 0.5;

  private isBoostingState: boolean = false;

  // Ambient deep drone
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
      filter.frequency.setValueAtTime(110, this.ctx.currentTime);

      this.ambientOsc.type = 'sine';
      this.ambientOsc.frequency.setValueAtTime(55, this.ctx.currentTime); // Gentle A1 sub drone

      this.ambientGain.gain.setValueAtTime(this.isMuted ? 0 : this.volume * 0.04, this.ctx.currentTime);

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
      this.ambientGain.gain.setValueAtTime(muted ? 0 : this.volume * 0.04, this.ctx.currentTime);
    }
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  public setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.ambientGain && this.ctx && !this.isMuted) {
      this.ambientGain.gain.setValueAtTime(this.volume * 0.04, this.ctx.currentTime);
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
      osc.frequency.exponentialRampToValueAtTime(freq * 1.4, this.ctx.currentTime + 0.07);

      const peakGain = Math.min(0.22, 0.07 + value * 0.015) * this.volume;
      gain.gain.setValueAtTime(peakGain, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.09);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.09);
    } catch {
      // Audio context may be closed or locked
    }
  }

  // Non-continuous acceleration sound: marks only beginning and ending of boost
  public setBoosting(boosting: boolean): void {
    if (boosting === this.isBoostingState) return;

    if (boosting) {
      this.isBoostingState = true;
      this.playBoostStart();
    } else {
      this.isBoostingState = false;
      this.playBoostEnd();
    }
  }

  // Boost Initiation: Crisp upward aerodynamic surge & ignition chirp
  public playBoostStart(): void {
    if (this.isMuted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;

      // 1. Upward energetic surge tone (triangle wave)
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(130, now);
      osc.frequency.exponentialRampToValueAtTime(340, now + 0.1);

      gain.gain.setValueAtTime(this.volume * 0.26, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.12);

      // 2. Air burst puff (short bandpass noise burst)
      const bufferSize = Math.floor(this.ctx.sampleRate * 0.09);
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
      }

      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(450, now);
      filter.frequency.exponentialRampToValueAtTime(950, now + 0.09);
      filter.Q.setValueAtTime(2.2, now);

      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(this.volume * 0.2, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

      noise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(this.ctx.destination);

      noise.start(now);
    } catch {
      // Ignore
    }
  }

  // Boost Release: Soft pneumatic exhaust & gentle descending pitch drop
  public playBoostEnd(): void {
    if (this.isMuted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;

      // 1. Soft descending pitch drop
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(260, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.09);

      gain.gain.setValueAtTime(this.volume * 0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.1);

      // 2. Soft air exhaust release
      const bufferSize = Math.floor(this.ctx.sampleRate * 0.08);
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
      }

      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(550, now);
      filter.frequency.exponentialRampToValueAtTime(160, now + 0.08);

      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(this.volume * 0.15, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

      noise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(this.ctx.destination);

      noise.start(now);
    } catch {
      // Ignore
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
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.exponentialRampToValueAtTime(30, now + 0.38);

      gain.gain.setValueAtTime(this.volume * 0.45, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.42);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.42);

      // Noise explosion burst
      const bufferSize = Math.floor(this.ctx.sampleRate * 0.32);
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(850, now);
      filter.frequency.exponentialRampToValueAtTime(80, now + 0.32);

      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(this.volume * 0.38, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);

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

      osc.type = 'sine';
      osc.frequency.setValueAtTime(240, now);
      osc.frequency.exponentialRampToValueAtTime(35, now + 0.6);

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(900, now);
      filter.frequency.exponentialRampToValueAtTime(70, now + 0.6);

      gain.gain.setValueAtTime(this.volume * 0.4, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);

      osc.connect(gain);
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
