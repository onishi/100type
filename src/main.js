import { POEMS } from "./data/poems.js";
import { TypingTarget } from "./romaji.js";

const $ = (id) => document.getElementById(id);
const SETTINGS_KEY = "100type.settings";
const BEST_KEY = "100type.best";

const DEFAULTS = { count: 10, order: "random", level: "easy" };
const RANKS = [
  [300, "歌聖"],
  [220, "歌仙"],
  [140, "歌人"],
  [80, "歌詠み"],
  [0, "詠み人知らず"],
];

const el = {
  screens: {
    start: $("screen-start"),
    play: $("screen-play"),
    result: $("screen-result"),
  },
  card: $("card"),
  poemNo: $("poem-no"),
  author: $("poem-author"),
  kami: $("kami"),
  kamiKana: $("kami-kana"),
  shimoKanji: $("shimo-kanji"),
  shimoKana: $("shimo-kana"),
  romaji: $("romaji"),
  hudProgress: $("hud-progress"),
  hudTime: $("hud-time"),
  hudKpm: $("hud-kpm"),
  hudAcc: $("hud-acc"),
  hudMiss: $("hud-miss"),
  progressFill: $("progress-fill"),
  imeWarn: $("ime-warn"),
  capture: $("capture"),
  bestRecord: $("best-record"),
};

const settings = loadSettings();

/** @type {{poems:object[], index:number, target:TypingTarget|null, startedAt:number|null,
 *          endedAt:number|null, keys:number, miss:number, log:object[], poemStartedAt:number,
 *          poemMiss:number, finished:boolean}} */
let game = null;
let tick = null;

/* ── 設定 ─────────────────────────────────── */
function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* プライベートモードなどでは保存しない */
  }
}

function bindChoices(containerId, key, onChange) {
  const container = $(containerId);
  const paint = () => {
    for (const btn of container.querySelectorAll(".choice")) {
      const value = btn.dataset.value;
      const current = String(settings[key]);
      btn.setAttribute("aria-checked", String(value === current));
    }
  };
  container.addEventListener("click", (e) => {
    const btn = e.target.closest(".choice");
    if (!btn) return;
    const raw = btn.dataset.value;
    settings[key] = key === "count" ? Number(raw) : raw;
    saveSettings();
    paint();
    onChange?.();
  });
  paint();
}

/* ── 記録 ─────────────────────────────────── */
const bestKey = () => `${settings.count}-${settings.order}-${settings.level}`;

function loadBests() {
  try {
    return JSON.parse(localStorage.getItem(BEST_KEY) || "{}");
  } catch {
    return {};
  }
}

function getBest() {
  return loadBests()[bestKey()] ?? null;
}

function saveBest(record) {
  const bests = loadBests();
  const prev = bests[bestKey()];
  if (prev && prev.kpm >= record.kpm) return false;
  bests[bestKey()] = record;
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(bests));
  } catch {
    return false;
  }
  return true;
}

function renderBest() {
  const best = getBest();
  el.bestRecord.textContent = best
    ? `この設定の自己ベスト　${best.kpm} 打/分・正確率 ${best.accuracy}%`
    : "";
}

/* ── 画面遷移 ─────────────────────────────── */
function show(name) {
  for (const [key, node] of Object.entries(el.screens)) node.hidden = key !== name;
}

/* ── ゲーム ───────────────────────────────── */
function pickPoems() {
  const pool = [...POEMS];
  if (settings.order === "random") {
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
  }
  return pool.slice(0, Math.min(settings.count, pool.length));
}

function startGame() {
  game = {
    poems: pickPoems(),
    index: 0,
    target: null,
    startedAt: null,
    endedAt: null,
    keys: 0,
    miss: 0,
    log: [],
    poemStartedAt: 0,
    poemMiss: 0,
    finished: false,
  };
  el.imeWarn.hidden = true;
  show("play");
  loadPoem();
  updateHud();
  clearInterval(tick);
  tick = setInterval(updateHud, 100);
  focusCapture();
}

function focusCapture() {
  // スマートフォンでソフトキーボードを呼び出すための隠し入力
  try {
    el.capture.focus({ preventScroll: true });
  } catch {
    /* 失敗しても物理キーボードでは問題ない */
  }
}

function loadPoem() {
  const poem = game.poems[game.index];
  game.target = new TypingTarget(poem.shimoKana);
  game.poemStartedAt = performance.now();
  game.poemMiss = 0;

  el.poemNo.textContent = `第${poem.n}番`;
  el.author.textContent = poem.author;
  setPhrases(el.kami, poem.kami);
  setPhrases(el.kamiKana, poem.kamiKana);
  el.kamiKana.hidden = settings.level === "hard";
  setPhrases(el.shimoKanji, poem.shimo);
  el.shimoKanji.hidden = settings.level !== "hard";
  el.card.classList.remove("clear");
  renderTarget();
}

/** 句（スペース区切り）ごとに折り返すよう inline-block で包む */
function setPhrases(node, text) {
  node.replaceChildren();
  for (const phrase of text.split(/\s+/).filter(Boolean)) {
    const span = document.createElement("span");
    span.className = "phrase";
    span.textContent = phrase;
    node.append(span);
  }
}

function renderTarget() {
  const poem = game.poems[game.index];
  const target = game.target;
  const confirmed = target.confirmedKanaLength();

  // かな表示（上級では下の句を漢字のみで示すため非表示）
  if (settings.level === "hard") {
    el.shimoKana.hidden = true;
  } else {
    el.shimoKana.hidden = false;
    el.shimoKana.replaceChildren();
    let idx = 0;
    for (const phrase of poem.shimoKana.split(/\s+/).filter(Boolean)) {
      const group = document.createElement("span");
      group.className = "phrase";
      for (const ch of phrase) {
        const span = document.createElement("span");
        span.textContent = ch;
        span.className = idx < confirmed ? "done" : idx === confirmed ? "cursor" : "todo";
        idx++;
        group.append(span);
      }
      el.shimoKana.append(group);
    }
  }

  // ローマ字表示（初級のみ）
  if (settings.level !== "easy") {
    el.romaji.hidden = true;
    return;
  }
  el.romaji.hidden = false;
  const hint = target.hint();
  const typed = target.typed;
  el.romaji.replaceChildren();
  const done = document.createElement("span");
  done.className = "done";
  done.textContent = typed;
  const next = document.createElement("span");
  next.className = "next";
  next.textContent = hint.slice(typed.length, typed.length + 1);
  const rest = document.createTextNode(hint.slice(typed.length + 1));
  el.romaji.append(done, next, rest);
}

function handleKey(ch) {
  if (!game || game.finished || game.target.done) return; // 次の歌へ移る間の打鍵は無視する
  if (game.startedAt === null) {
    game.startedAt = performance.now();
    game.poemStartedAt = game.startedAt;
  }
  const ok = game.target.input(ch);
  if (ok) {
    game.keys++;
  } else {
    game.miss++;
    game.poemMiss++;
    el.card.classList.remove("miss");
    void el.card.offsetWidth; // リフローさせてアニメーションを再生
    el.card.classList.add("miss");
  }
  renderTarget();
  updateHud();
  if (game.target.done) completePoem();
}

function completePoem() {
  const poem = game.poems[game.index];
  game.log.push({
    poem,
    seconds: (performance.now() - game.poemStartedAt) / 1000,
    miss: game.poemMiss,
  });
  el.card.classList.add("clear");
  game.index++;
  if (game.index >= game.poems.length) {
    finishGame();
    return;
  }
  setTimeout(() => {
    if (game && !game.finished) loadPoem();
  }, 260);
}

function elapsedSeconds() {
  if (!game || game.startedAt === null) return 0;
  return ((game.endedAt ?? performance.now()) - game.startedAt) / 1000;
}

function stats() {
  const seconds = elapsedSeconds();
  const kpm = seconds > 0 ? Math.round((game.keys / seconds) * 60) : 0;
  const total = game.keys + game.miss;
  const accuracy = total > 0 ? Math.round((game.keys / total) * 1000) / 10 : 100;
  return { seconds, kpm, accuracy };
}

function updateHud() {
  if (!game) return;
  const { seconds, kpm, accuracy } = stats();
  el.hudProgress.textContent = `${Math.min(game.index + 1, game.poems.length)} / ${game.poems.length}`;
  el.hudTime.innerHTML = `${seconds.toFixed(1)}<small>秒</small>`;
  el.hudKpm.textContent = String(kpm);
  el.hudAcc.innerHTML = `${accuracy}<small>%</small>`;
  el.hudMiss.textContent = String(game.miss);
  const doneChars = game.index / game.poems.length;
  el.progressFill.style.width = `${Math.round(doneChars * 100)}%`;
}

function finishGame() {
  game.finished = true;
  game.endedAt = performance.now();
  clearInterval(tick);
  updateHud();

  const { seconds, kpm, accuracy } = stats();
  const rank = RANKS.find(([threshold]) => kpm * (accuracy / 100) >= threshold)[1];

  $("result-rank").textContent = rank;
  $("r-time").innerHTML = `${seconds.toFixed(1)}<small>秒</small>`;
  $("r-keys").textContent = String(game.keys);
  $("r-kpm").textContent = String(kpm);
  $("r-acc").innerHTML = `${accuracy}<small>%</small>`;
  $("r-miss").textContent = String(game.miss);
  $("r-count").innerHTML = `${game.poems.length}<small>首</small>`;

  const record = { kpm, accuracy, seconds: Math.round(seconds * 10) / 10, at: new Date().toISOString() };
  const prevBest = getBest();
  const updated = saveBest(record);
  $("r-best").textContent = updated
    ? "自己ベスト更新！"
    : prevBest
      ? `自己ベストは ${prevBest.kpm} 打/分`
      : "";

  const list = $("review-list");
  list.replaceChildren();
  for (const entry of game.log) {
    const li = document.createElement("li");
    const b = document.createElement("b");
    b.textContent = `${entry.poem.kami} ${entry.poem.shimo}`;
    const meta = document.createElement("span");
    meta.textContent = `${entry.seconds.toFixed(1)}秒 / ミス${entry.miss}`;
    li.append(b, meta);
    list.append(li);
  }

  show("result");
  renderBest();
}

function quitGame() {
  clearInterval(tick);
  game = null;
  show("start");
  renderBest();
}

/* ── 入力 ─────────────────────────────────── */
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const playing = !el.screens.play.hidden;

  if (e.key === "Escape") {
    if (playing) quitGame();
    return;
  }
  if (e.key === "Enter") {
    if (!el.screens.start.hidden) startGame();
    else if (!el.screens.result.hidden) startGame();
    return;
  }
  if (!playing || !game || game.finished) return;

  if (e.isComposing || e.keyCode === 229) {
    el.imeWarn.hidden = false;
    return;
  }
  if (e.key.length !== 1) return;
  if (!/^[a-zA-Z0-9,.\-']$/.test(e.key)) return;
  e.preventDefault();
  el.imeWarn.hidden = true;
  handleKey(e.key);
});

// 変換候補が確定された場合（IME オン）にも気づけるようにする
el.capture.addEventListener("input", () => {
  if (el.capture.value !== "") {
    el.imeWarn.hidden = false;
    el.capture.value = "";
  }
});

el.screens.play.addEventListener("click", focusCapture);

/* ── 起動 ─────────────────────────────────── */
bindChoices("choice-count", "count", renderBest);
bindChoices("choice-order", "order", renderBest);
bindChoices("choice-level", "level", renderBest);
$("btn-start").addEventListener("click", startGame);
$("btn-again").addEventListener("click", startGame);
$("btn-home").addEventListener("click", quitGame);
$("btn-quit").addEventListener("click", quitGame);
renderBest();
