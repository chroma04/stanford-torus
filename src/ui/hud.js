import { CIRC, SPOKES, SPOKE_SPACING } from '../core/config.js';
import { zoneAt, TOWN_NAMES, SEGMENT_NAMES, SEGMENT_BIOMES } from '../world/layout.js';

const BIOME_COLORS = {
  lake: '#6fb7d6',
  farm: '#d9b45a',
  forest: '#4f8f5a',
  paddy: '#9ccf6a',
  lake2: '#7fc7c4',
  meadow: '#e3a4c4',
};

export function placeName(s) {
  const z = zoneAt(s);
  if (z.town > 0.5) {
    return { name: TOWN_NAMES[z.spoke], sub: `Spoke ${z.spoke + 1} · town plaza` };
  }
  const segName = SEGMENT_NAMES[z.seg];
  if (z.core > 0.5) return { name: `${segName} ${z.biome.label}`, sub: `Between spokes ${z.seg + 1} and ${((z.seg + 1) % SPOKES) + 1}` };
  const near = TOWN_NAMES[z.spoke];
  return { name: `${near} Terraces`, sub: `Residential quarter · spoke ${z.spoke + 1}` };
}

export class Hud {
  constructor() {
    this.el = document.getElementById('hud');
    this.nameEl = document.getElementById('place-name');
    this.subEl = document.getElementById('place-sub');
    this.placeEl = document.getElementById('place');
    this.clockEl = document.getElementById('clock');
    this.toastEl = document.getElementById('toast');
    this.map = document.getElementById('minimap');
    this.ctx = this.map.getContext('2d');
    this.lastName = '';
    this.nameTimer = 0;
    this.toastTimer = 0;
    this.visible = true;
  }

  show(v) {
    this.el.classList.toggle('hidden', !v);
  }

  toast(msg) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    this.toastTimer = 2.2;
  }

  update(dt, player, env) {
    const p = placeName(player.s);
    if (p.name !== this.lastName) {
      this.lastName = p.name;
      this.nameEl.textContent = p.name;
      this.subEl.textContent = p.sub;
      this.placeEl.style.opacity = '1';
      this.nameTimer = 6;
    }
    this.nameTimer -= dt;
    if (this.nameTimer < 0) this.placeEl.style.opacity = '0.35';
    this.toastTimer -= dt;
    if (this.toastTimer < 0) this.toastEl.classList.remove('show');
    this.clockEl.textContent = (env.paused ? '⏸ ' : '') + env.clock;
    this.drawMap(player);
  }

  drawMap(player) {
    const c = this.ctx;
    const W = this.map.width;
    const cx = W / 2;
    const cy = W / 2;
    const R = W * 0.38;
    c.clearRect(0, 0, W, W);
    c.fillStyle = 'rgba(15,20,32,0.45)';
    c.beginPath();
    c.arc(cx, cy, W / 2 - 2, 0, Math.PI * 2);
    c.fill();
    // ring segments coloured by biome (the view is centred on the player's heading)
    const rot = -Math.PI / 2 - (player.s / CIRC) * Math.PI * 2;
    c.lineWidth = 14;
    for (let k = 0; k < SPOKES; k++) {
      const a0 = rot + (k / SPOKES) * Math.PI * 2;
      const a1 = rot + ((k + 1) / SPOKES) * Math.PI * 2;
      c.strokeStyle = BIOME_COLORS[SEGMENT_BIOMES[k].key];
      c.beginPath();
      c.arc(cx, cy, R, a0 + 0.12, a1 - 0.12);
      c.stroke();
      // towns
      c.strokeStyle = '#f2ead8';
      c.beginPath();
      c.arc(cx, cy, R, a0 - 0.12, a0 + 0.12);
      c.stroke();
    }
    // spokes & hub
    c.lineWidth = 2;
    c.strokeStyle = 'rgba(230,236,242,0.7)';
    for (let k = 0; k < SPOKES; k++) {
      const a = rot + (k / SPOKES) * Math.PI * 2;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * 9, cy + Math.sin(a) * 9);
      c.lineTo(cx + Math.cos(a) * (R - 7), cy + Math.sin(a) * (R - 7));
      c.stroke();
    }
    c.fillStyle = '#e6ecf2';
    c.beginPath();
    c.arc(cx, cy, 8, 0, Math.PI * 2);
    c.fill();
    // player (always at the top of the ring)
    const pa = -Math.PI / 2;
    const px = cx + Math.cos(pa) * R;
    const py = cy + Math.sin(pa) * R;
    const heading = Math.cos(player.yaw); // +1 = towards +s (clockwise on the map)
    c.fillStyle = '#ffcf5a';
    c.strokeStyle = '#1d2230';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(px, py, 6, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.fillStyle = '#ffcf5a';
    c.beginPath();
    const dir = heading >= 0 ? 1 : -1;
    c.moveTo(px + dir * 14, py + 1);
    c.lineTo(px + dir * 7, py - 5);
    c.lineTo(px + dir * 7, py + 6);
    c.closePath();
    c.fill();
    c.font = '600 10px system-ui, sans-serif';
    c.fillStyle = 'rgba(230,236,242,0.85)';
    c.textAlign = 'center';
    c.fillText(`${Math.round((player.s / CIRC) * 360)}°`, cx, cy + 22);
    void SPOKE_SPACING;
  }
}
