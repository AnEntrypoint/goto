class SoundManager {
  constructor() {
    try {
      const audioContext = window.AudioContext || window.webkitAudioContext;
      this.ctx = new audioContext();
      this.enabled = true;
    } catch (e) {
      console.warn('Web Audio API not available');
      this.enabled = false;
    }
    this.volume = 0.3;
    this.musicEnabled = true;
    this.sfxEnabled = true;
    this.musicOscillators = [];
  }

  playTone(freq, duration, type = 'sine') {
    if (!this.enabled || !this.sfxEnabled) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.type = type;
    osc.frequency.value = freq;

    gain.gain.setValueAtTime(this.volume, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);

    osc.start(this.ctx.currentTime);
    osc.stop(this.ctx.currentTime + duration);
  }

  playNoise(duration) {
    if (!this.enabled || !this.sfxEnabled) return;
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * duration, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < buffer.length; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const source = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    source.buffer = buffer;
    source.connect(gain);
    gain.connect(this.ctx.destination);

    gain.gain.setValueAtTime(this.volume * 0.3, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);

    source.start(this.ctx.currentTime);
  }

  playJump() {
    this.playTone(400, 0.15);
  }

  playLand() {
    this.playNoise(0.1);
    setTimeout(() => this.playTone(200, 0.05), 30);
  }

  playBreak() {
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        this.playNoise(0.08);
        this.playTone(300 - i * 50, 0.08);
      }, i * 60);
    }
  }

  playGoal() {
    const freqs = [523.25, 659.25, 783.99];
    for (let i = 0; i < freqs.length; i++) {
      setTimeout(() => this.playTone(freqs[i], 0.2), i * 150);
    }
  }

  playDeath() {
    for (let i = 0; i < 4; i++) {
      setTimeout(() => {
        this.playTone(300 - i * 50, 0.1);
      }, i * 80);
    }
  }

  startMusic() {
    if (!this.enabled || !this.musicEnabled) return;

    const bassFreq = 164.81;
    const melodyFreqs = [246.94, 329.63, 392.0, 329.63];

    const playMelody = () => {
      for (let i = 0; i < melodyFreqs.length; i++) {
        setTimeout(() => {
          this.playTone(melodyFreqs[i], 0.4);
        }, i * 500);
      }
      setTimeout(playMelody, melodyFreqs.length * 500);
    };

    playMelody();
  }

  stopMusic() {
    this.musicOscillators.forEach(osc => {
      try {
        osc.stop();
      } catch (e) {}
    });
    this.musicOscillators = [];
  }
}
