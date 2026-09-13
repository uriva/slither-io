class SoundSystem {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;
  private volume: number = 0.5;

  // Boost whoosh nodes (aerodynamic filtered rush + warm sub swell)
  private boostNoiseSource: AudioBufferSourceNode | null = null;
  private boostFilter: BiquadFilterNode | null = null;
  private boostGain: GainNode | null = null;
  private boostSubOsc: OscillatorNode | null = null;
  private boostSubGain: GainNode | null = null;

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
    if (this.boostGain && this.ctx) {
      this.boostGain.gain.setValueAtTime(0, this.ctx.currentTime);
    }
    if (this.boostSubGain && this.ctx) {
      this.boostSubGain.gain.setValueAtTime(0, this.ctx.currentTime);
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

  // Sleek Aerodynamic Sci-Fi Slipstream & Warm Sub Boost
  public setBoosting(boosting: boolean): void {
    if (this.isMuted || !this.ctx) {
      if (this.boostGain && this.ctx) {
        this.boostGain.gain.setValueAtTime(0, this.ctx.currentTime);
      }
      if (this.boostSubGain && this.ctx) {
        this.boostSubGain.gain.setValueAtTime(0, this.ctx.currentTime);
      }
      return;
    }

    try {
      if (!this.boostNoiseSource) {
        // Create 2-second looping soft pink/brown noise buffer for natural aerodynamic rush
        const bufferSize = this.ctx.sampleRate * 2;
        const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        let lastOut = 0.0;
        for (let i = 0; i < bufferSize; i++) {
          const white = Math.random() * 2 - 1;
          // Pink noise 1-pole filter
          lastOut = (lastOut * 0.94) + (white * 0.06);
          data[i] = lastOut * 3.5;
        }

        this.boostNoiseSource = this.ctx.createBufferSource();
        this.boostNoiseSource.buffer = noiseBuffer;
        this.boostNoiseSource.loop = true;

        this.boostFilter = this.ctx.createBiquadFilter();
        this.boostFilter.type = 'lowpass';
        this.boostFilter.frequency.setValueAtTime(260, this.ctx.currentTime);
        this.boostFilter.Q.setValueAtTime(1.5, this.ctx.currentTime);

        this.boostGain = this.ctx.createGain();
        this.boostGain.gain.setValueAtTime(0, this.ctx.currentTime);

        this.boostNoiseSource.connect(this.boostFilter);
        this.boostFilter.connect(this.boostGain);
        this.boostGain.connect(this.ctx.destination);
        this.boostNoiseSource.start();

        // Warm sub-bass harmonic glide (gentle sine wave)
        this.boostSubOsc = this.ctx.createOscillator();
        this.boostSubGain = this.ctx.createGain();
        this.boostSubOsc.type = 'sine';
        this.boostSubOsc.frequency.setValueAtTime(65, this.ctx.currentTime);
        this.boostSubGain.gain.setValueAtTime(0, this.ctx.currentTime);

        this.boostSubOsc.connect(this.boostSubGain);
        this.boostSubGain.connect(this.ctx.destination);
        this.boostSubOsc.start();
      }

      const now = this.ctx.currentTime;
      if (this.boostGain && this.boostFilter && this.boostSubGain && this.boostSubOsc) {
        if (boosting && !this.isMuted) {
          // Smooth aerodynamic whoosh sweep
          this.boostGain.gain.cancelScheduledValues(now);
          this.boostGain.gain.setTargetAtTime(this.volume * 0.18, now, 0.08);

          this.boostFilter.frequency.cancelScheduledValues(now);
          this.boostFilter.frequency.setTargetAtTime(680, now, 0.12);

          this.boostSubGain.gain.cancelScheduledValues(now);
          this.boostSubGain.gain.setTargetAtTime(this.volume * 0.14, now, 0.08);

          this.boostSubOsc.frequency.cancelScheduledValues(now);
          this.boostSubOsc.frequency.setTargetAtTime(85, now, 0.15);
        } else {
          // Fade out smoothly without abrupt click
          this.boostGain.gain.cancelScheduledValues(now);
          this.boostGain.gain.setTargetAtTime(0.0001, now, 0.07);

          this.boostFilter.frequency.cancelScheduledValues(now);
          this.boostFilter.frequency.setTargetAtTime(260, now, 0.1);

          this.boostSubGain.gain.cancelScheduledValues(now);
          this.boostSubGain.gain.setTargetAtTime(0.0001, now, 0.07);

          this.boostSubOsc.frequency.cancelScheduledValues(now);
          this.boostSubOsc.frequency.setTargetAtTime(60, now, 0.1);
        }
      }
    } catch {
      // Ignore audio unlock errors
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
      const bufferSize = this.ctx.sampleRate * 0.32;
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
