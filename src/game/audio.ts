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
      if (window.mindblown?.sound) {
        if (window.mindblown.sound.on !== undefined) {
          this.isMuted = !window.mindblown.sound.on;
        }
        window.mindblown.sound.onchange?.((on: boolean) => {
          this.setMuted(!on);
        });
      }

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
    try {
      if (typeof window !== 'undefined' && window.mindblown?.sound) {
        window.mindblown.sound.set(!muted);
      }
    } catch {
      // Ignore
    }
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

  // Boost Initiation: Authentic aerodynamic air whoosh (pure filtered wind rush, zero synth beeps)
  public playBoostStart(): void {
    if (this.isMuted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const duration = 0.24;

      // Soft pink/brown noise buffer
      const bufferSize = Math.floor(this.ctx.sampleRate * duration);
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99 * b0 + white * 0.05;
        b1 = 0.95 * b1 + white * 0.11;
        b2 = 0.85 * b2 + white * 0.25;
        data[i] = (b0 + b1 + b2) * 1.8;
      }

      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      // Resonant bandpass sweep (rushing wind arc: 180Hz -> 950Hz -> 360Hz)
      const bandpass = this.ctx.createBiquadFilter();
      bandpass.type = 'bandpass';
      bandpass.Q.setValueAtTime(1.8, now);
      bandpass.frequency.setValueAtTime(180, now);
      bandpass.frequency.exponentialRampToValueAtTime(950, now + 0.08);
      bandpass.frequency.exponentialRampToValueAtTime(360, now + duration);

      // Lowpass smoothing filter to keep it silky and natural
      const lowpass = this.ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.setValueAtTime(1400, now);

      const gain = this.ctx.createGain();
      // Natural whoosh swell and decay envelope
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(this.volume * 0.42, now + 0.07);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      noise.connect(bandpass);
      bandpass.connect(lowpass);
      lowpass.connect(gain);
      gain.connect(this.ctx.destination);

      noise.start(now);
      noise.stop(now + duration);
    } catch {
      // Ignore
    }
  }

  // Boost Release: Soft trailing wind exhalation / air decrescendo
  public playBoostEnd(): void {
    if (this.isMuted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const duration = 0.18;

      const bufferSize = Math.floor(this.ctx.sampleRate * duration);
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let b0 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.92 * b0 + white * 0.08;
        data[i] = b0 * 2.2;
      }

      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      // Gentle downward wind trail (580Hz -> 140Hz)
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(580, now);
      filter.frequency.exponentialRampToValueAtTime(140, now + duration);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(this.volume * 0.28, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);

      noise.start(now);
      noise.stop(now + duration);
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

  public playChat(): void {
    if (this.isMuted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.08); // A5
      gain.gain.setValueAtTime(this.volume * 0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.12);
    } catch {
      // Ignore
    }
  }
}

export const sound = new SoundSystem();
