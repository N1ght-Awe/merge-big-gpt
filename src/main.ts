import './style.css';
import { LEVELS } from './config';
import { Game } from './game';
import type { GameState, PhysicsEvent } from './types';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';

const icons = {
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>',
  book: '<path d="M12 6v15m0-15C9 3 5 3 2 4v15c4-1 7-1 10 2 3-3 6-3 10-2V4c-3-1-7-1-10 2Z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3v.1"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="m8 5 11 7-11 7Z"/>',
  restart: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
  volume: '<path d="m11 4-6 5H2v6h3l6 5ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  muted: '<path d="m11 4-6 5H2v6h3l6 5Zm5 5 6 6m0-6-6 6"/>',
  crown: '<path d="m3 6 5 4 4-6 4 6 5-4-2 12H5Zm2 15h14"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  heart: '<path d="M20 5c-3-3-6-1-8 1-2-2-5-4-8-1-4 4 1 9 8 15 7-6 12-11 8-15Z"/>',
};
const icon = (name: keyof typeof icons, className = '') =>
  `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
const number = (value: number) => value.toLocaleString('zh-CN');

function galleryMarkup(isDialog = false): string {
  return LEVELS.map((level, index) => `
    <li class="dex-row ${index === LEVELS.length - 1 ? 'dex-legend' : ''}" data-dex-level="${index}">
      <span class="dex-number">${String(level.id).padStart(2, '0')}</span>
      <span class="dex-image" style="--character-color:${level.color}">
        <img src="${level.image}" alt="${isDialog ? level.name : ''}" width="160" height="160" loading="${isDialog ? 'lazy' : 'eager'}">
      </span>
      <span class="dex-copy"><span class="dex-name">${level.name}</span><span class="dex-detail">${index === LEVELS.length - 1 ? '传说中的终极形态' : isDialog ? `合成得 ${level.score} 分` : '等待灵感碰撞'}</span></span>
      <span class="dex-discovered" aria-label="已发现">✓</span>
    </li>`).join('');
}

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <div class="page-shell">
    <header class="site-header">
      <a href="#" class="brand" aria-label="合成大GPT首页"><span class="brand-mark">${icon('spark')}</span><span>龙娘糖果屋<small>每次碰撞，都有一点魔法</small></span></a>
      <div class="title-sign"><span class="title-star" aria-hidden="true">✦</span><h1 id="game-title">合成大<span>GPT</span></h1><span class="title-star star-pink" aria-hidden="true">✦</span></div>
      <nav aria-label="游戏导航">
        <button class="nav-button collection-button" id="open-gallery">${icon('book')}<span>收藏册</span><span class="collection-count"><strong id="discovered-count">1</strong>/11</span></button>
        <button class="nav-button help-button" id="open-help" title="怎么玩">${icon('help')}<span>玩法</span></button>
      </nav>
    </header>
    <main aria-labelledby="game-title">
      <div class="arcade">
        <span class="scene-cloud cloud-left" aria-hidden="true"></span><span class="scene-cloud cloud-right" aria-hidden="true"></span>
        <span class="scene-star scene-star-one" aria-hidden="true">✦</span><span class="scene-star scene-star-two" aria-hidden="true">✦</span>
        <aside class="game-hud" aria-label="分数与下一只角色">
          <section class="score-card">
            <div class="score-label">${icon('spark')}<span>本局得分</span></div>
            <div class="score-value" id="score-value">0</div>
            <div class="best-score">${icon('crown')}<span>最高</span><strong id="best-value">0</strong></div>
          </section>
          <section class="next-card" aria-label="下一个角色">
            <div class="next-heading"><span>下一只</span><span class="next-tag">NEXT</span></div>
            <div class="next-character"><span class="next-orbit" aria-hidden="true"></span><img id="next-image" src="${LEVELS[0].image}" alt="${LEVELS[0].name}" width="112" height="112"></div>
            <div id="next-name" class="next-name">${LEVELS[0].name}</div>
          </section>
          <div class="hud-note"><span aria-hidden="true">✧</span> 两只一样，合出新可爱</div>
        </aside>
        <section class="play-column" aria-label="合成大GPT游戏区域">
          <div class="bottle-cap"><span class="cap-star" aria-hidden="true">✦</span><span>龙娘の魔法工坊</span><span class="cap-star" aria-hidden="true">✦</span></div>
          <div class="board-heading"><span class="live-dot"></span><span id="board-status">灵感正在酝酿</span></div>
          <div class="canvas-shell" id="canvas-shell">
            <canvas id="game-canvas" width="440" height="620" tabindex="0" aria-label="合成大GPT游戏画布。移动鼠标瞄准，点击投放；也可用左右方向键瞄准、空格投放、P暂停。"></canvas>
            <div class="game-toast" id="game-toast" role="status" aria-live="polite" aria-atomic="true"></div>
            <div class="game-overlay" id="game-overlay" hidden></div>
          </div>
          <div class="board-instructions"><span class="desktop-instruction"><span class="instruction-dot"></span>移动瞄准 · 点击投放</span><span class="mobile-instruction"><span class="instruction-dot"></span>拖动瞄准 · 松手投放</span><span class="instruction-extra">相同龙娘碰一碰！</span></div>
        </section>
        <div class="game-controls" aria-label="游戏操作">
          <button id="pause-button" class="control-button pause-control" title="暂停（P）">${icon('pause')}<span>暂停</span></button>
          <button id="restart-button" class="control-button restart-control" title="重新开始">${icon('restart')}<span>重开</span></button>
          <button id="mute-button" class="control-button sound-control" title="关闭声音" aria-pressed="false">${icon('volume')}<span>声音</span></button>
          <span class="control-spark" aria-hidden="true">✧</span>
        </div>
      </div>
    </main>
    <footer class="site-footer"><span class="keyboard-tip"><kbd>←</kbd><kbd>→</kbd> 瞄准 <span>·</span> <kbd>空格</kbd> 投放 <span>·</span> <kbd>P</kbd> 暂停</span><span class="save-note">${icon('heart')} 本局进度与最高分自动保存</span></footer>
  </div>
  <dialog id="info-dialog" aria-labelledby="dialog-title"><div class="dialog-content" id="dialog-content"></div></dialog>
`;

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const canvas = $<HTMLCanvasElement>('#game-canvas');
const scoreValue = $('#score-value');
const bestValue = $('#best-value');
const nextImage = $<HTMLImageElement>('#next-image');
const nextName = $('#next-name');
const boardStatus = $('#board-status');
const overlay = $('#game-overlay');
const pauseButton = $<HTMLButtonElement>('#pause-button');
const muteButton = $<HTMLButtonElement>('#mute-button');
const dialog = $<HTMLDialogElement>('#info-dialog');
const toast = $('#game-toast');
let previousStatus = '';
let previousNext = -1;
let previousMute: boolean | undefined;
let lastGalleryLevel = -1;
let lastScore = -1;
let lastBest = -1;
let dialogResume = false;
let dialogTrigger: HTMLElement | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let crownToastUntil = 0;
let currentState: GameState;

function updateGallery(level: number): void {
  document.querySelectorAll<HTMLElement>('[data-dex-level]').forEach((row) => {
    const unlocked = Number(row.dataset.dexLevel) <= level;
    row.classList.toggle('is-discovered', unlocked);
    row.querySelector('.dex-discovered')?.setAttribute('aria-hidden', String(!unlocked));
    if (!row.closest('dialog')) {
      const detail = row.querySelector<HTMLElement>('.dex-detail')!;
      detail.textContent = Number(row.dataset.dexLevel) === 10 ? '传说中的终极形态' : unlocked ? '本局已发现' : '等待灵感碰撞';
    }
  });
  $('#discovered-count').textContent = String(level + 1);
}

function render(state: GameState): void {
  currentState = state;
  if (state.score !== lastScore) {
    scoreValue.textContent = number(state.score);
    if (lastScore >= 0 && state.score > lastScore) {
      scoreValue.classList.remove('score-pop');
      void scoreValue.offsetWidth;
      scoreValue.classList.add('score-pop');
    }
    lastScore = state.score;
  }
  if (state.best !== lastBest) {
    bestValue.textContent = number(state.best);
    lastBest = state.best;
  }
  if (state.nextLevel !== previousNext) {
    const next = LEVELS[state.nextLevel];
    nextImage.src = next.image;
    nextImage.alt = next.name;
    nextName.textContent = next.name;
    previousNext = state.nextLevel;
  }
  if (state.maxLevel !== lastGalleryLevel) {
    updateGallery(state.maxLevel);
    lastGalleryLevel = state.maxLevel;
  }
  if (state.muted !== previousMute) {
    muteButton.innerHTML = `${icon(state.muted ? 'muted' : 'volume')}<span>${state.muted ? '静音' : '声音'}</span>`;
    muteButton.setAttribute('aria-pressed', String(state.muted));
    muteButton.setAttribute('aria-label', state.muted ? '开启声音' : '关闭声音');
    muteButton.title = state.muted ? '开启声音' : '关闭声音';
    previousMute = state.muted;
  }
  const statusLabel = state.status === 'paused' ? '休息一下，灵感不跑' : state.status === 'gameover' ? '灵感需要重新整理' : state.canDrop ? '灵感正在酝酿' : '正在接住小灵感';
  if (boardStatus.textContent !== statusLabel) boardStatus.textContent = statusLabel;
  if (state.status !== previousStatus) {
    previousStatus = state.status;
    app.dataset.gameStatus = state.status;
    pauseButton.disabled = state.status === 'gameover';
    pauseButton.innerHTML = `${icon(state.status === 'paused' ? 'play' : 'pause')}<span>${state.status === 'paused' ? '继续' : '暂停'}</span>`;
    pauseButton.title = state.status === 'paused' ? '继续（P）' : '暂停（P）';
    if (state.status === 'playing') {
      overlay.hidden = true;
      overlay.innerHTML = '';
    } else if (state.status === 'paused') {
      overlay.hidden = false;
      overlay.innerHTML = `<div class="overlay-card"><div class="overlay-symbol">${icon('pause')}</div><span class="eyebrow">魔法充能中</span><h2>让灵感歇一会儿</h2><p>你的小龙娘们会乖乖等你回来。</p><button class="primary-button" id="resume-game">${icon('play')}继续合成</button><span class="overlay-footnote">也可以按 P 继续</span></div>`;
      $('#resume-game').addEventListener('click', () => { game.resume(); canvas.focus({ preventScroll: true }); });
    } else {
      overlay.hidden = false;
      overlay.innerHTML = `<div class="overlay-card gameover-card"><img class="gameover-character" src="${LEVELS[Math.max(1, state.maxLevel)].image}" alt=""><span class="eyebrow">下次一定会更厉害</span><h2>上下文溢出了！</h2><p>休息一下，下一局灵感会更多。</p><div class="result-grid"><div><span>本局灵感值</span><strong>${number(state.score)}</strong></div><div><span>历史最佳</span><strong>${number(state.best)}</strong></div></div><div class="result-character">本局成长至 <strong>${LEVELS[state.maxLevel].name}</strong></div><button class="primary-button" id="play-again">${icon('restart')}再来一局</button><span class="overlay-footnote">每一个伟大的 GPT，都从一句对话开始。</span></div>`;
      $('#play-again').addEventListener('click', restart);
      $('#play-again').focus({ preventScroll: true });
    }
  }
}

function showToast(event: PhysicsEvent): void {
  if (event.type !== 'merge' && event.type !== 'crown') return;
  if (event.type === 'merge' && performance.now() < crownToastUntil) return;
  if (toastTimer) clearTimeout(toastTimer);
  if (event.type === 'crown') {
    crownToastUntil = performance.now() + 4200;
    toast.innerHTML = `<span class="toast-crown">${icon('crown')}伟大的 GPT 龙娘大人，降临！</span>`;
    toast.className = 'game-toast visible legendary-toast';
  } else {
    toast.innerHTML = `${event.combo > 1 ? `<strong class="combo-badge">COMBO ×${event.combo}</strong>` : `<span class="toast-spark">${icon('spark')}</span>`}<span>${LEVELS[event.level].quip}</span><strong class="toast-points">+${event.points}</strong>`;
    toast.className = `game-toast visible ${event.combo >= 5 ? 'combo-epic' : event.combo >= 3 ? 'combo-great' : event.combo > 1 ? 'combo-nice' : ''}`;
  }
  toastTimer = setTimeout(() => { toast.classList.remove('visible'); }, event.type === 'crown' ? 4200 : 2100);
}

const game = new Game(canvas, render, showToast);
render(game.snapshot());
if (import.meta.env.DEV && new URLSearchParams(location.search).has('debug')) {
  (window as Window & { __GPT_GAME__?: Game }).__GPT_GAME__ = game;
}

function restart(): void {
  if (toastTimer) clearTimeout(toastTimer);
  crownToastUntil = 0;
  toast.classList.remove('visible');
  dialogResume = false;
  if (dialog.open) dialog.close();
  game.restart();
  render(game.snapshot());
  canvas.focus({ preventScroll: true });
}

function closeDialog(): void { dialog.close(); }

function openDialog(content: string): void {
  if (dialog.open) return;
  dialogTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  dialogResume = currentState.status === 'playing';
  if (dialogResume) game.pause();
  app.classList.add('has-dialog');
  $('#dialog-content').innerHTML = `<button class="dialog-close" aria-label="关闭弹窗">${icon('close')}</button>${content}`;
  dialog.classList.toggle('art-gallery-dialog', content.includes('dialog-dex'));
  dialog.querySelector('.dialog-close')!.addEventListener('click', closeDialog);
  dialog.showModal();
  updateGallery(currentState.maxLevel);
}

dialog.addEventListener('close', () => {
  app.classList.remove('has-dialog');
  if (dialogResume && game.snapshot().status === 'paused') game.resume();
  dialogResume = false;
  dialogTrigger?.focus({ preventScroll: true });
});
dialog.addEventListener('click', (event) => {
  if (event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog();
});
// Dialog keyboard events belong to the dialog; P and Space must not control the game.
dialog.addEventListener('keydown', (event) => event.stopPropagation());

$('#open-help').addEventListener('click', () => {
  openDialog(`<span class="dialog-kicker">糖果屋游玩指南</span><h2 id="dialog-title">碰一碰，就有新灵感</h2><p class="dialog-lead">玩法很简单，龙娘很可爱。</p><ol class="help-steps"><li><span>01</span><div><h3>找个好位置，轻轻放下</h3><p>电脑上移动鼠标瞄准，点击投放。手机上拖动瞄准，松手投放。也可用 ← → 或 A / D 瞄准、空格投放。</p></div></li><li><span>02</span><div><h3>相同的龙娘，会一起长大</h3><p>两个相同等级碰到一起，就会合成为下一级，获得灵感值。连续合成会触发 Combo 和更欢快的音效。</p></div></li><li><span>03</span><div><h3>留一点空间，给下一颗灵感</h3><p>球的最下沿也高于警戒线时，才会判负；压线、部分越线都允许，不设倒计时。新球自由下落、经过警戒线时不警报也不判负；接触地面或已有堆积后才开始判定。最终目标是合出第 11 级「伟大的 GPT 龙娘大人」！</p></div></li></ol><div class="help-note">${icon('heart')}按 P 可暂停。切换页面时会自动暂停，回来后点击继续。本局进度、最高分和声音设置保存在本机；重新打开后点击继续即可。</div><button class="primary-button dialog-action" id="help-done">明白了，开始碰撞 ${icon('arrow')}</button>`);
  $('#help-done').addEventListener('click', closeDialog);
});

$('#open-gallery').addEventListener('click', () => {
  openDialog(`<span class="dialog-kicker">龙娘收藏册</span><h2 id="dialog-title">11 种可爱，一路长大</h2><p class="dialog-lead">从一句对话，到伟大的 GPT 龙娘大人。</p><ol class="dex-list dialog-dex">${galleryMarkup(true)}</ol><p class="gallery-note">打勾的角色是本局已发现的成长阶段。</p>`);
});

pauseButton.addEventListener('click', () => {
  if (currentState.status === 'paused') game.resume();
  else game.pause();
  render(game.snapshot());
  canvas.focus({ preventScroll: true });
});
muteButton.addEventListener('click', () => {
  game.toggleMute();
  render(game.snapshot());
});
$('#restart-button').addEventListener('click', () => {
  if (currentState.drops === 0 || currentState.status === 'gameover') {
    restart();
    return;
  }
  openDialog(`<div class="confirm-symbol">${icon('restart')}</div><span class="dialog-kicker">再来一点新灵感</span><h2 id="dialog-title">重新整理一下灵感？</h2><p class="dialog-lead">这局的龙娘会回到起点，历史最高分会保留。</p><div class="confirm-actions"><button class="secondary-button" id="cancel-restart">再想想</button><button class="primary-button" id="confirm-restart">重新开始 ${icon('arrow')}</button></div>`);
  $('#cancel-restart').addEventListener('click', closeDialog);
  $('#confirm-restart').addEventListener('click', restart);
  $('#cancel-restart').focus();
});

window.addEventListener('pagehide', () => {
  if (toastTimer) clearTimeout(toastTimer);
});
if (import.meta.hot) import.meta.hot.dispose(() => game.destroy());

const nativeListeners: PluginListenerHandle[] = [];
if (Capacitor.isNativePlatform()) {
  void (async () => {
    nativeListeners.push(await NativeApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) game.pause();
    }));
    nativeListeners.push(await NativeApp.addListener('backButton', () => {
      if (dialog.open) { dialog.close(); return; }
      game.pause();
      void NativeApp.exitApp();
    }));
  })();
}
if (import.meta.hot) import.meta.hot.dispose(() => {
  for (const listener of nativeListeners) void listener.remove();
});
