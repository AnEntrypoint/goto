class SpriteRenderer {
  constructor() {
    this.lastVelX = 0;
    this.frameCount = 0;
  }

  drawPlayer(ctx, x, y, state, frameNum) {
    this.frameCount++;
    const onGround = state.on_ground;
    const velX = state.vel_x || 0;
    const velY = state.vel_y || 0;
    this.lastVelX = velX !== 0 ? velX : this.lastVelX;
    const facingRight = this.lastVelX > 0;

    let state_type = 'idle';
    if (!onGround && velY < -2) state_type = 'jump';
    else if (!onGround && velY > 2) state_type = 'fall';
    else if (onGround && Math.abs(velX) > 5) state_type = 'walk';

    const headX = x + (facingRight ? 8 : -8);
    const headY = y - 10;
    const bodyY = y;
    const legY = y + 8;

    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;

    switch (state_type) {
      case 'idle':
        const breathe = Math.sin(this.frameCount * 0.05) * 2;
        ctx.beginPath();
        ctx.arc(headX, headY + breathe, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillRect(headX - 5, bodyY - 2, 10, 12);
        ctx.fillRect(headX - 3, legY, 3, 6);
        ctx.fillRect(headX + 1, legY, 3, 6);
        break;

      case 'walk':
        const legSwing = Math.sin(this.frameCount * 0.15) * 4;
        ctx.beginPath();
        ctx.arc(headX, headY, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillRect(headX - 5, bodyY - 2, 10, 12);
        ctx.fillRect(headX - 3, legY + legSwing, 3, 6);
        ctx.fillRect(headX + 1, legY - legSwing, 3, 6);
        break;

      case 'jump':
        ctx.beginPath();
        ctx.arc(headX, headY - 8, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillRect(headX - 5, bodyY - 8, 10, 12);
        ctx.fillRect(headX - 5, legY - 8, 4, 8);
        ctx.fillRect(headX + 2, legY - 8, 4, 8);
        break;

      case 'fall':
        ctx.beginPath();
        ctx.arc(headX, headY, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillRect(headX - 5, bodyY - 2, 10, 12);
        ctx.fillRect(headX - 8, bodyY + 2, 5, 4);
        ctx.fillRect(headX + 4, bodyY + 2, 5, 4);
        break;
    }

    ctx.fillStyle = '#000000';
    ctx.font = 'bold 8px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`P${state.player_id}`, x, y - 18);
  }

  drawEnemy(ctx, x, y, frameNum) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((frameNum * 0.1) % (Math.PI * 2));

    ctx.fillStyle = '#FF4444';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(7, -2);
    ctx.lineTo(4, 8);
    ctx.lineTo(-4, 8);
    ctx.lineTo(-7, -2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(-3, -2, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(3, -2, 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  drawPlatform(ctx, x, y, w, h, damaged) {
    ctx.fillStyle = damaged ? '#8B5A3C' : '#8B7355';
    ctx.fillRect(x - w / 2, y - h / 2, w, h);

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.strokeRect(x - w / 2, y - h / 2, w, h);

    if (damaged) {
      ctx.strokeStyle = '#5C4033';
      ctx.lineWidth = 1;
      const cracks = Math.min(3, Math.floor(damaged * 0.5));
      for (let i = 0; i < cracks; i++) {
        const cx = x - w / 2 + (w * (i + 1)) / (cracks + 1);
        const cy1 = y - h / 2;
        const cy2 = y + h / 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy1);
        ctx.lineTo(cx + (Math.random() - 0.5) * 4, cy2);
        ctx.stroke();
      }
    }
  }
}
