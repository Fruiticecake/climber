import type { PreviewData } from './preview.js'

/** 放进 <script> 里的 JSON：转义 <，模型写的文字里出现 </script> 也不会提前结束脚本 */
export function embedJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

const STYLE = `
:root {
  --bg: #121315; --panel: #1b1d20; --panel-2: #23262a; --line: #33373c;
  --text: #ecebe6; --muted: #9a9d9f; --chalk: #f4f1e8;
  --left: #35d0c0; --right: #ff8a3d; --accent: #f4c84a; --foot-hold: #c79bff;
  --bad: #ff6b6b; --warn: #f4c84a; --ok: #6fd08c;
  --radius: 14px; --ease: cubic-bezier(0.16, 1, 0.3, 1);
  --font: "PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif;
  --mono: ui-monospace, "SF Mono", Consolas, monospace;
  color-scheme: dark;
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body { background: var(--bg); color: var(--text); font: 15px/1.6 var(--font); }
.app { display: grid; grid-template-columns: minmax(0, 1fr) 420px; height: 100vh; }
.stage { position: relative; background: radial-gradient(circle at 50% 40%, #202327, var(--bg) 70%); overflow: hidden; }
.stage svg { width: 100%; height: 100%; display: block; }
.badge { position: absolute; left: 16px; top: 16px; padding: 6px 12px; border-radius: 999px; background: rgb(18 19 21 / 0.72);
  backdrop-filter: blur(6px); font-size: 12px; color: var(--muted); border: 1px solid var(--line); }
.legend { position: absolute; left: 16px; bottom: 16px; display: flex; gap: 14px; padding: 8px 12px; border-radius: 10px;
  background: rgb(18 19 21 / 0.72); backdrop-filter: blur(6px); font-size: 12px; color: var(--muted); }
.legend i { display: inline-block; width: 10px; height: 10px; margin-right: 6px; vertical-align: -1px; }
.panel { display: flex; flex-direction: column; background: var(--panel); border-left: 1px solid var(--line); min-height: 0; }
header { padding: 20px 22px 14px; border-bottom: 1px solid var(--line); }
header h1 { margin: 0; font-size: 19px; letter-spacing: 0.02em; }
header p { margin: 4px 0 0; color: var(--muted); font-size: 13px; }
.status { display: inline-block; margin-left: 8px; padding: 1px 8px; border-radius: 999px; font-size: 12px; vertical-align: 2px; }
.status.ok { background: rgb(111 208 140 / 0.15); color: var(--ok); }
.status.bad { background: rgb(255 107 107 / 0.15); color: var(--bad); }
.card { flex: 1; overflow-y: auto; padding: 18px 22px 8px; }
.counter { font: 600 13px var(--mono); color: var(--muted); letter-spacing: 0.08em; }
.counter b { font-size: 34px; color: var(--chalk); letter-spacing: 0; margin-right: 4px; }
.move { margin: 6px 0 12px; font-size: 22px; font-weight: 600; }
.move .limb-l { color: var(--left); } .move .limb-r { color: var(--right); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
.chip { padding: 2px 10px; border-radius: 999px; background: var(--panel-2); color: var(--muted); font-size: 12px; border: 1px solid var(--line); }
.chip.tech { color: var(--accent); border-color: rgb(244 200 74 / 0.35); background: rgb(244 200 74 / 0.08); }
.block { margin: 0 0 14px; }
.block h3 { margin: 0 0 3px; font-size: 12px; font-weight: 600; color: var(--muted); letter-spacing: 0.1em; }
.block p { margin: 0; }
.block.mistake { padding-left: 10px; border-left: 3px solid var(--bad); }
.alert { margin: 0 0 10px; padding: 8px 12px; border-radius: 10px; font-size: 13px; }
.alert.bad { background: rgb(255 107 107 / 0.12); color: #ffb3b3; }
.alert.warn { background: rgb(244 200 74 / 0.1); color: #f6dc8f; }
.timeline { display: flex; gap: 4px; padding: 0 22px 12px; overflow-x: auto; scrollbar-width: thin; }
.timeline button { flex: 0 0 auto; min-width: 34px; height: 30px; border-radius: 8px; border: 1px solid var(--line); background: var(--panel-2);
  color: var(--muted); font: 600 12px var(--mono); cursor: pointer; transition: background 150ms, color 150ms, transform 150ms var(--ease); }
.timeline button.l { box-shadow: inset 0 -2px 0 var(--left); } .timeline button.r { box-shadow: inset 0 -2px 0 var(--right); }
.timeline button.has-bad { border-color: var(--bad); }
.timeline button[aria-current="step"] { background: var(--chalk); color: var(--bg); transform: translateY(-2px); }
.controls { display: grid; grid-template-columns: auto auto auto 1fr auto; align-items: center; gap: 10px; padding: 14px 22px 18px;
  border-top: 1px solid var(--line); background: var(--panel); }
.controls button { width: 42px; height: 42px; border-radius: 50%; border: 1px solid var(--line); background: var(--panel-2); color: var(--text);
  font-size: 16px; cursor: pointer; transition: background 150ms, transform 150ms var(--ease); }
.controls button:hover { background: #2d3136; }
.controls button:active { transform: scale(0.94); }
.controls button.play { width: 50px; height: 50px; background: var(--chalk); color: var(--bg); border: 0; font-size: 18px; }
.controls input[type=range] { width: 100%; accent-color: var(--accent); }
.controls select { background: var(--panel-2); color: var(--text); border: 1px solid var(--line); border-radius: 8px; padding: 6px; font: 13px var(--mono); }
button:focus-visible, select:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.note { padding: 0 22px 10px; color: var(--muted); font-size: 12px; }
@media (max-width: 860px) {
  .app { grid-template-columns: minmax(0, 1fr); grid-template-rows: 58vh auto; height: auto; min-height: 100vh; }
  .panel { min-width: 0; border-left: 0; border-top: 1px solid var(--line); }
  .card { overflow: visible; padding: 16px 16px 6px; }
  header, .timeline, .note { padding-left: 16px; padding-right: 16px; }
  .controls { position: sticky; bottom: 0; padding: 12px 16px 14px; }
  .legend { display: none; }
}
`

const SCRIPT = `
const D = DATA;
const NS = 'http://www.w3.org/2000/svg';
const LIMBS = ['LH', 'RH', 'LF', 'RF'];
const SIDE = { LH: 'l', RH: 'r', LF: 'l', RF: 'r' };
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (id) => document.getElementById(id);
const svg = $('stage-svg');
const el = (tag, attrs, parent) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); if (parent) parent.appendChild(n); return n; };

// 视野：框住所有岩点和所有帧的小人，留出边距
(function fitView() {
  const pts = D.holds.map((h) => [h.x, h.y]);
  for (const f of D.frames) { for (const l of LIMBS) pts.push([f.limbs[l].at.x, f.limbs[l].at.y]); pts.push([f.shoulder.x, f.shoulder.y]); }
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const m = Math.max(D.width, D.height) * 0.08;
  const x0 = Math.max(0, Math.min(...xs) - m), y0 = Math.max(0, Math.min(...ys) - m * 1.6);
  const x1 = Math.min(D.width, Math.max(...xs) + m), y1 = Math.min(D.height, Math.max(...ys) + m);
  svg.setAttribute('viewBox', [x0, y0, x1 - x0, y1 - y0].join(' '));
})();

const unit = Math.max(D.width, D.height) / 160;
const defs = el('defs', {}, svg);
const clip = el('clipPath', { id: 'route-holds' }, defs);
D.holds.forEach((h) => el('circle', { cx: h.x, cy: h.y, r: h.r * 1.35 }, clip));
el('filter', { id: 'grey' }, defs).innerHTML = '<feColorMatrix type="saturate" values="0.05"/><feComponentTransfer><feFuncR type="linear" slope="0.42"/><feFuncG type="linear" slope="0.42"/><feFuncB type="linear" slope="0.42"/></feComponentTransfer>';

if (PHOTO) {
  el('image', { href: PHOTO, x: 0, y: 0, width: D.width, height: D.height, filter: 'url(#grey)' }, svg);
  el('image', { href: PHOTO, x: 0, y: 0, width: D.width, height: D.height, 'clip-path': 'url(#route-holds)' }, svg);
} else {
  // 没有照片时按 Kilter 板的灯色画：起步绿、中间青、结束品红、脚点橙
  const FILL = { 'start-hand': '#3ddc84', top: '#e45bd8', 'foot-only': '#f2a33a', 'start-foot': '#f2a33a', normal: '#47c6e6' };
  el('rect', { x: 0, y: 0, width: D.width, height: D.height, fill: '#2a2d31' }, svg);
  D.holds.forEach((h) => el('circle', { cx: h.x, cy: h.y, r: h.r, fill: FILL[h.role] || '#c9b458', opacity: 0.55 }, svg));
}
const holdLayer = el('g', {}, svg);
const RING = { top: 'var(--accent)', 'start-hand': 'var(--chalk)', 'foot-only': 'var(--foot-hold)', 'start-foot': 'var(--foot-hold)' };
const PREFIX = { top: 'TOP ', 'start-hand': '起 ', 'foot-only': '脚 ', 'start-foot': '起脚 ' };
D.holds.forEach((h) => {
  const color = RING[h.role] || 'rgb(244 241 232 / 0.55)';
  el('circle', { cx: h.x, cy: h.y, r: h.r * 1.35, fill: 'none', stroke: color, 'stroke-width': unit * 0.35, 'stroke-dasharray': h.role === 'normal' ? '' : unit * 0.9 }, holdLayer);
  const t = el('text', { x: h.x + h.r * 1.35 + unit * 0.4, y: h.y - h.r * 0.9, fill: color, 'font-size': unit * 2.1, 'font-family': 'ui-monospace, Consolas, monospace', 'font-weight': 700 }, holdLayer);
  t.textContent = (PREFIX[h.role] || '') + '#' + h.id;
});

// 小人：躯干、四肢连线、头；四个肢体端点
const fig = el('g', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, svg);
const trail = el('line', { stroke: 'var(--accent)', 'stroke-width': unit * 0.35, 'stroke-dasharray': unit * 0.8 + ' ' + unit * 0.6, opacity: 0 }, fig);
const bone = (side) => el('line', { stroke: side === 'l' ? 'var(--left)' : 'var(--right)', 'stroke-width': unit * 0.9, opacity: 0.9 }, fig);
const bones = { LH: bone('l'), RH: bone('r'), LF: bone('l'), RF: bone('r') };
const torso = el('line', { stroke: 'var(--chalk)', 'stroke-width': unit * 1.6 }, fig);
const head = el('circle', { r: unit * 2.1, fill: 'var(--chalk)' }, fig);
const pulse = el('circle', { r: unit * 3, fill: 'none', stroke: 'var(--accent)', 'stroke-width': unit * 0.5 }, fig);
const ends = {};
for (const l of LIMBS) {
  const g = el('g', {}, fig);
  const color = SIDE[l] === 'l' ? 'var(--left)' : 'var(--right)';
  const s = unit * 1.9;
  const shape = l[1] === 'H'
    ? el('circle', { r: s, fill: color, stroke: 'var(--bg)', 'stroke-width': unit * 0.4 }, g)
    : el('rect', { x: -s, y: -s, width: s * 2, height: s * 2, transform: 'rotate(45)', fill: color, stroke: 'var(--bg)', 'stroke-width': unit * 0.4 }, g);
  const label = el('text', { 'text-anchor': 'middle', y: unit * 0.75, 'font-size': unit * 2, 'font-weight': 700, fill: 'var(--bg)' }, g);
  label.textContent = { LH: '左', RH: '右', LF: '左', RF: '右' }[l];
  ends[l] = { g, shape, color };
}

const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const ease = (t) => 1 - Math.pow(1 - t, 3);
function headAt(hip, sh) {
  const dx = sh.x - hip.x, dy = sh.y - hip.y, len = Math.hypot(dx, dy) || 1;
  return { x: sh.x + (dx / len) * unit * 3.4, y: sh.y + (dy / len) * unit * 3.4 };
}
function draw(a, b, t) {
  const hip = lerp(a.hip, b.hip, t), sh = lerp(a.shoulder, b.shoulder, t);
  set(torso, { x1: hip.x, y1: hip.y, x2: sh.x, y2: sh.y });
  const h = headAt(hip, sh); set(head, { cx: h.x, cy: h.y });
  const at = spread(Object.fromEntries(LIMBS.map((l) => [l, lerp(a.limbs[l].at, b.limbs[l].at, t)])));
  for (const l of LIMBS) {
    const p = at[l];
    const root = l[1] === 'H' ? sh : hip;
    set(bones[l], { x1: root.x, y1: root.y, x2: p.x, y2: p.y });
    ends[l].g.setAttribute('transform', 'translate(' + p.x + ' ' + p.y + ')');
    const state = b.limbs[l].state, hollow = state === 'smear' || state === 'flag' || state === 'free';
    ends[l].shape.setAttribute('fill', hollow ? 'var(--bg)' : ends[l].color);
    ends[l].shape.setAttribute('stroke', hollow ? ends[l].color : 'var(--bg)');
    ends[l].shape.setAttribute('stroke-dasharray', state === 'smear' ? unit * 0.7 : '');
    bones[l].setAttribute('stroke-dasharray', state === 'flag' || state === 'free' ? unit * 1.2 + ' ' + unit * 0.8 : '');
  }
  const mover = b.step && b.step.limb;
  if (mover) {
    const from = a.limbs[mover].at, to = b.limbs[mover].at, cur = lerp(from, to, t);
    set(trail, { x1: from.x, y1: from.y, x2: to.x, y2: to.y, opacity: a === b ? 0 : 0.9 });
    set(pulse, { cx: cur.x, cy: cur.y, opacity: 1 });
  } else { set(trail, { opacity: 0 }); set(pulse, { opacity: 0 }); }
}
// 几个肢体在同一个点上（并手、手脚同点）时左右错开，免得互相盖住；顺序是左手、右手、左脚、右脚
function spread(at) {
  const out = { ...at }, gap = unit * 3.6, done = new Set();
  for (const l of LIMBS) {
    if (done.has(l)) continue;
    const group = LIMBS.filter((m) => !done.has(m) && Math.hypot(at[m].x - at[l].x, at[m].y - at[l].y) < gap);
    group.forEach((m, k) => { done.add(m); out[m] = { x: at[m].x + (k - (group.length - 1) / 2) * gap, y: at[m].y }; });
  }
  return out;
}
function set(n, attrs) { for (const k in attrs) n.setAttribute(k, attrs[k]); }

// 步骤卡片：模型写的文字一律用 textContent
const card = $('card');
function text(tag, cls, content) { const n = document.createElement(tag); if (cls) n.className = cls; n.textContent = content; return n; }
function block(title, body, cls) { const b = text('div', 'block' + (cls ? ' ' + cls : ''), ''); b.appendChild(text('h3', '', title)); b.appendChild(text('p', '', body)); return b; }
function renderCard(i) {
  const f = D.frames[i], s = f.step, total = D.frames.length - 1;
  card.replaceChildren();
  const counter = text('div', 'counter', '');
  counter.appendChild(text('b', '', String(i).padStart(2, '0'))); counter.append(' / ' + String(total).padStart(2, '0'));
  card.appendChild(counter);
  const move = text('div', 'move', '');
  if (s) { move.appendChild(text('span', SIDE[s.limb] === 'l' ? 'limb-l' : 'limb-r', s.limbName)); move.append(' → ' + s.target); }
  else move.textContent = '起始姿态';
  card.appendChild(move);
  if (s) {
    const chips = text('div', 'chips', '');
    [s.how, s.hips, s.motion].filter(Boolean).forEach((c) => chips.appendChild(text('span', 'chip', c)));
    s.techniques.forEach((c) => chips.appendChild(text('span', 'chip tech', c)));
    card.appendChild(chips);
  }
  f.violations.forEach((v) => card.appendChild(text('div', 'alert bad', '违规 · ' + v)));
  f.warnings.forEach((w) => card.appendChild(text('div', 'alert warn', '提示 · ' + w)));
  if (s) {
    if (s.note) card.appendChild(block('做什么', s.note));
    if (s.why) card.appendChild(block('为什么', s.why));
    if (s.mistake) card.appendChild(block('新手常见错误', s.mistake, 'mistake'));
  } else card.appendChild(block('整体思路', D.summary));
  timeline.querySelectorAll('button').forEach((b, k) => (k === i ? b.setAttribute('aria-current', 'step') : b.removeAttribute('aria-current')));
  const cur = timeline.children[i]; if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
  scrub.value = i;
}

const timeline = $('timeline'), scrub = $('scrub'), playBtn = $('play'), speedSel = $('speed');
D.frames.forEach((f, i) => {
  const b = document.createElement('button');
  b.textContent = i === 0 ? '起' : String(i);
  b.title = f.step ? f.step.limbName + ' → ' + f.step.target : '起始姿态';
  if (f.step) b.classList.add(SIDE[f.step.limb]);
  if (f.violations.length) b.classList.add('has-bad');
  b.addEventListener('click', () => { stop(); go(i); });
  timeline.appendChild(b);
});
scrub.max = D.frames.length - 1;

let current = 0, anim = 0, timer = 0, playing = false;
const MOVE_MS = 700, DWELL_MS = 1800;
function go(i, animate = true) {
  i = Math.max(0, Math.min(D.frames.length - 1, i));
  const from = D.frames[current], to = D.frames[i];
  const stepwise = animate && !reduceMotion && Math.abs(i - current) === 1;
  current = i; renderCard(i); cancelAnimationFrame(anim);
  // 直接跳到某一步：画出这一步的终点姿态，虚线标出这一步的移动
  if (!stepwise) { draw(i > 0 ? D.frames[i - 1] : to, to, 1); return; }
  const dur = MOVE_MS / Number(speedSel.value), t0 = performance.now();
  const tick = (now) => { const t = Math.min(1, (now - t0) / dur); draw(from, to, ease(t)); if (t < 1) anim = requestAnimationFrame(tick); };
  anim = requestAnimationFrame(tick);
}
function play() {
  if (current >= D.frames.length - 1) go(0, false);
  playing = true; playBtn.textContent = '❚❚'; playBtn.setAttribute('aria-label', '暂停');
  const next = () => { if (!playing) return; if (current >= D.frames.length - 1) return stop(); go(current + 1); timer = setTimeout(next, (MOVE_MS + DWELL_MS) / Number(speedSel.value)); };
  timer = setTimeout(next, 400);
}
function stop() { playing = false; clearTimeout(timer); playBtn.textContent = '▶'; playBtn.setAttribute('aria-label', '播放'); }
playBtn.addEventListener('click', () => (playing ? stop() : play()));
$('prev').addEventListener('click', () => { stop(); go(current - 1); });
$('next').addEventListener('click', () => { stop(); go(current + 1); });
scrub.addEventListener('input', () => { stop(); go(Number(scrub.value), false); });
document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement) return;
  if (e.key === 'ArrowRight') { stop(); go(current + 1); }
  else if (e.key === 'ArrowLeft') { stop(); go(current - 1); }
  else if (e.key === ' ') { e.preventDefault(); playing ? stop() : play(); }
});
go(0, false);
`

/** 生成一个自包含的预览页：数据、样式、脚本和照片都在一个文件里 */
export function renderPreviewHtml(data: PreviewData, photoDataUri: string | null): string {
  const status = data.passed ? '<span class="status ok">通过校验</span>' : '<span class="status bad">未通过校验</span>'
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(data.title)} · 爬法预览</title>
<style>${STYLE}</style>
</head>
<body>
<div class="app">
  <main class="stage" aria-label="线路和爬法示意">
    <svg id="stage-svg" preserveAspectRatio="xMidYMid meet" role="img" aria-label="岩壁照片上的四肢位置"></svg>
    <div class="badge">${photoDataUri ? '照片上只保留这条线的岩点' : '没有照片，按线路坐标画墙面'}</div>
    <div class="legend"><span><i style="background:var(--left);border-radius:50%"></i>左手</span><span><i style="background:var(--right);border-radius:50%"></i>右手</span><span><i style="background:var(--left);transform:rotate(45deg)"></i>左脚</span><span><i style="background:var(--right);transform:rotate(45deg)"></i>右脚</span><span><i style="border:1px dashed var(--muted)"></i>空心＝踩墙/悬空</span></div>
  </main>
  <aside class="panel">
    <header>
      <h1>${escapeHtml(data.title)}${status}</h1>
      <p>${escapeHtml(data.subtitle)}</p>
    </header>
    <section class="card" id="card" aria-live="polite"></section>
    <nav class="timeline" id="timeline" aria-label="步骤"></nav>
    <p class="note">小人只是示意：髋和肩按手脚位置估算，看不出扭转、落膝这类身体姿态。</p>
    <div class="controls">
      <button id="prev" aria-label="上一步">◀</button>
      <button id="play" class="play" aria-label="播放">▶</button>
      <button id="next" aria-label="下一步">▶▏</button>
      <input id="scrub" type="range" min="0" value="0" aria-label="跳到某一步">
      <select id="speed" aria-label="速度"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select>
    </div>
  </aside>
</div>
<script>
const DATA = ${embedJson(data)};
const PHOTO = ${photoDataUri ? embedJson(photoDataUri) : 'null'};
${SCRIPT}
</script>
</body>
</html>
`
}
