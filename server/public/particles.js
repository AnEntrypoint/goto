class Particle {
  constructor(x, y, vx, vy, color, life) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.color = color;
    this.life = life;
    this.maxLife = life;
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vy += 400 * dt;
    this.life -= dt;
  }

  render(ctx) {
    const alpha = this.life / this.maxLife;
    ctx.fillStyle = this.color.replace(')', `, ${alpha})`).replace('rgb', 'rgba');
    ctx.beginPath();
    ctx.arc(this.x, this.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

class ParticleSystem {
  constructor() {
    this.particles = [];
  }

  emit(type, x, y) {
    let count = 0;
    let color = 'rgb(255, 255, 255)';
    let speed = 200;

    switch (type) {
      case 'jump':
        count = 8;
        color = 'rgb(135, 206, 235)';
        speed = 150;
        for (let i = 0; i < count; i++) {
          const angle = (i / count) * Math.PI * 2;
          const vx = Math.cos(angle) * speed;
          const vy = Math.sin(angle) * speed - 100;
          this.particles.push(new Particle(x, y, vx, vy, color, 0.6));
        }
        break;

      case 'land':
        count = 12;
        color = 'rgb(139, 115, 85)';
        speed = 200;
        for (let i = 0; i < count; i++) {
          const angle = (i / count) * Math.PI * 2;
          const vx = Math.cos(angle) * speed;
          const vy = Math.sin(angle) * speed;
          this.particles.push(new Particle(x, y, vx, vy, color, 0.5));
        }
        break;

      case 'break':
        count = 15;
        color = 'rgb(205, 133, 63)';
        speed = 250;
        for (let i = 0; i < count; i++) {
          const angle = (i / count) * Math.PI * 2;
          const vx = Math.cos(angle) * speed;
          const vy = Math.sin(angle) * speed;
          this.particles.push(new Particle(x, y, vx, vy, color, 0.7));
        }
        break;

      case 'confetti':
        count = 4;
        const colors = ['rgb(255, 215, 0)', 'rgb(255, 165, 0)', 'rgb(255, 255, 255)', 'rgb(135, 206, 235)'];
        for (let i = 0; i < count; i++) {
          const vx = (Math.random() - 0.5) * 200;
          const vy = Math.random() * 100 - 150;
          this.particles.push(new Particle(x, y, vx, vy, colors[i % colors.length], 1.5));
        }
        break;

      case 'death':
        count = 20;
        color = 'rgb(255, 100, 100)';
        speed = 300;
        for (let i = 0; i < count; i++) {
          const angle = (i / count) * Math.PI * 2;
          const vx = Math.cos(angle) * speed;
          const vy = Math.sin(angle) * speed;
          this.particles.push(new Particle(x, y, vx, vy, color, 0.8));
        }
        break;
    }
  }

  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      this.particles[i].update(dt);
      if (this.particles[i].life <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }

  render(ctx) {
    for (const p of this.particles) {
      p.render(ctx);
    }
  }

  clear() {
    this.particles = [];
  }
}
