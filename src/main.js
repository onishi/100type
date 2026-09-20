import { POEMS } from "./data/poems.js";
import { TypingTarget } from "./romaji.js";
import * as audio from "./audio.js";
import { kimarijiLabel, kimarijiLength, kimarijiText } from "./kimariji.js";

const $ = (id) => document.getElementById(id);
const SETTINGS_KEY = "100type.settings";
const BEST_KEY = "100type.best";

const DEFAULTS = {
  count: 10,
  order: "random",
  level: "easy",
  wait: 2000,
  voice: true,
  readShimo: true,
  se: true,
  rate: 0.8,
  translation: true,
};
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
  kimariji: $("kimariji-badge"),
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
  reading: $("reading"),
  readingLabel: $("reading-label"),
  readingNote: $("reading-note"),
  voiceNotice: $("voice-notice"),
  voiceSetting: $("voice-setting"),
  translation: $("translation"),
  mute: $("btn-mute"),
  readingFill: $("reading-fill"),
  capture: $("capture"),
  bestRecord: $("best-record"),
};

const settings = loadSettings();

/** @type {{poems:object[], index:number, target:TypingTarget|null, startedAt:number|null,
 *          endedAt:number|null, keys:number, miss:number, log:object[], poemStartedAt:number,
 *          poemMiss:number, finished:boolean}} */
let game = null;
let tick = null;
let revealTimer = null;
let advanceTimer = null;
let pendingAdvance = null;

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
    settings[key] = ["count", "wait", "rate"].includes(key) ? Number(raw) : raw;
    saveSettings();
    paint();
    onChange?.();
  });
  paint();
}

function bindToggles(containerId) {
  const container = $(containerId);
  const paint = () => {
    for (const btn of container.querySelectorAll(".choice")) {
      btn.setAttribute("aria-checked", String(Boolean(settings[btn.dataset.key])));
    }
  };
  container.addEventListener("click", (e) => {
    const btn = e.target.closest(".choice");
    if (!btn) return;
    settings[btn.dataset.key] = !settings[btn.dataset.key];
    saveSettings();
    paint();
    audio.unlock();
    if (settings[btn.dataset.key] && btn.dataset.key === "se") audio.sfx.key();
    updateVoiceNotice();
    updateMuteButton();
  });
  paint();
}

/** 読み上げに渡す共通の設定 */
function voiceOptions(extra) {
  return { rate: settings.rate, ...extra };
}

/** 日本語の音声がない環境では速さの設定も隠す */
function renderVoiceSetting() {
  el.voiceSetting.hidden = !audio.speechAvailable();
}

/** 日本語の音声が見つからないブラウザではその旨を伝える */
function updateVoiceNotice() {
  const missing = settings.voice && !audio.speechAvailable();
  el.voiceNotice.hidden = !missing;
  el.voiceNotice.textContent = missing
    ? "このブラウザでは日本語の音声が見つかりません。詠み上げは鳴りませんが、そのまま遊べます。"
    : "";
}

/** 選んだ声で一句だけ読んでみる */
function tryVoice() {
  audio.unlock();
  audio.speak("あきのたの かりほのいおの とまおあらみ", voiceOptions());
}

function updateMuteButton() {
  const on = settings.voice || settings.se;
  el.mute.textContent = on ? "音を止める" : "音を出す";
  el.mute.setAttribute("aria-pressed", String(!on));
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
  audio.unlock();
  clearTimeout(advanceTimer);
  pendingAdvance = null;
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
    phase: "reading",
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
  game.target = new TypingTarget(poem.shimoKana, poem.shimoModern, poem.shimoSound);
  game.poemStartedAt = performance.now();
  game.poemMiss = 0;
  // 上の句だけを見せる「詠み上げ」の間。打ち始めは待たずにできる。
  game.phase = settings.wait > 0 ? "reading" : "typing";
  game.typedDone = false;
  game.recited = true;

  el.poemNo.textContent = `第${poem.n}番`;
  el.author.textContent = poem.author;
  setPhrases(el.kami, poem.kami);
  setKamiKana(poem);
  el.kamiKana.hidden = settings.level === "hard";
  el.kimariji.textContent = kimarijiLabel(poem);
  el.translation.textContent = poem.modern;
  el.translation.classList.toggle("on", settings.translation);
  setPhrases(el.shimoKanji, poem.shimo);
  el.card.classList.remove("clear");
  startReading();
  renderTarget();
}

/**
 * 上の句を読み上げつつ、詠み待ちのあいだ下の句を伏せておく。
 * 読み上げと詠み待ちは別々に動く。読み上げは待ち時間の設定によらず必ず流し、
 * 下の句は設定した待ち時間ちょうどで表示する（読み上げの途中でも待たない）。
 */
function startReading() {
  clearTimeout(revealTimer);
  audio.stopSpeaking();

  const poem = game.poems[game.index];
  const speaking =
    settings.voice && audio.speak(poem.kamiSpeech, voiceOptions({ onPhrase: highlightPhrase }));
  // 詠み手は打ち手を待たず、上の句に続けて下の句まで詠む
  game.recited = true;
  if (speaking && settings.readShimo) {
    const queued = audio.speak(
      poem.shimoSound,
      voiceOptions({ queue: true, onPhrase: highlightShimoPhrase, onEnd: onRecitationEnd })
    );
    if (queued) game.recited = false;
  }
  el.readingLabel.firstChild.textContent = speaking ? "詠み上げ中" : "まもなく下の句";
  el.readingNote.textContent = "覚えていれば先に打てます／Space ですぐ表示";
  if (!speaking) highlightPhrase(-1);

  if (game.phase !== "reading") {
    el.reading.classList.add("invisible");
    // 「詠み待ちなし」でも読み上げはそのまま流す
    return;
  }
  el.reading.classList.remove("invisible");
  const fill = el.readingFill;
  fill.style.transition = "none";
  fill.style.width = "0%";
  void fill.offsetWidth; // リフローさせてからアニメーションを開始する
  fill.style.transition = `width ${settings.wait}ms linear`;
  fill.style.width = "100%";
  revealTimer = setTimeout(reveal, settings.wait);
}

/** 読み上げ中の句を光らせる（-1 で消す） */
function highlightPhrase(index) {
  highlightIn(el.kami, index);
  highlightIn(el.kamiKana, index);
}

/** 下の句を詠むときは下の句の側を光らせる */
function highlightShimoPhrase(index) {
  highlightIn(el.shimoKana, index);
  highlightIn(el.shimoKanji, index);
}

function highlightIn(node, index) {
  node.querySelectorAll(".phrase").forEach((phrase, i) => {
    phrase.classList.toggle("speaking", i === index);
  });
}

function onRecitationEnd() {
  if (!game) return;
  game.recited = true;
  highlightShimoPhrase(-1);
  maybeAdvance();
}

function reveal() {
  clearTimeout(revealTimer);
  if (!game || game.phase !== "reading") return;
  game.phase = "typing";
  el.reading.classList.add("invisible");
  renderTarget();
}

/** 上の句の読みを句ごとに並べ、決まり字の部分に印をつける */
function setKamiKana(poem) {
  const mark = kimarijiLength(poem);
  el.kamiKana.replaceChildren();
  let index = 0;
  for (const phrase of poem.kamiKana.split(/\s+/).filter(Boolean)) {
    const group = document.createElement("span");
    group.className = "phrase";
    for (const ch of phrase) {
      if (index < mark) {
        const span = document.createElement("span");
        span.className = "kimariji";
        span.textContent = ch;
        group.append(span);
      } else {
        group.append(document.createTextNode(ch));
      }
      index++;
    }
    el.kamiKana.append(group);
  }
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
  const reading = game.phase === "reading";

  el.shimoKanji.hidden = settings.level !== "hard" || reading;
  // 詠み上げを待つあいだと上級では、まだ打っていない部分を伏せる。
  // 打ったぶんは出すので、どこまで進んだかは分かる。
  const masked = reading || settings.level === "hard";

  el.shimoKana.hidden = false;
  el.shimoKana.classList.toggle("masked", masked);
  el.shimoKana.replaceChildren();
  let idx = 0;
  for (const phrase of poem.shimoKana.split(/\s+/).filter(Boolean)) {
    const group = document.createElement("span");
    group.className = "phrase";
    for (const ch of phrase) {
      if (masked && idx >= confirmed) {
        idx++;
        continue;
      }
      const span = document.createElement("span");
      span.textContent = ch;
      span.className = idx < confirmed ? "done" : idx === confirmed ? "cursor" : "todo";
      idx++;
      group.append(span);
    }
    if (group.childNodes.length) el.shimoKana.append(group);
  }
  // 伏せているときは、次に打つ位置に印を出す
  if (masked && !target.done) {
    const caret = document.createElement("span");
    caret.className = "caret";
    caret.setAttribute("aria-hidden", "true");
    (el.shimoKana.lastElementChild ?? el.shimoKana).append(caret);
  }

  // ローマ字表示。打ち終えたぶんはどのモードでも出し、
  // これから打つぶんを見せるのは初級だけ（詠み上げ中は伏せる）。
  const showAhead = settings.level === "easy" && !reading;
  el.romaji.hidden = false;
  el.romaji.replaceChildren();
  const typed = document.createElement("span");
  typed.className = showAhead ? "done" : "typed";
  typed.textContent = target.typed;
  el.romaji.append(typed);
  if (!showAhead) return;

  const hint = target.hint();
  const next = document.createElement("span");
  next.className = "next";
  next.textContent = hint.slice(target.typed.length, target.typed.length + 1);
  el.romaji.append(next, document.createTextNode(hint.slice(target.typed.length + 1)));
}

/** Space 相当の操作：詠み上げを飛ばす／次の歌へ進む */
function skipAhead() {
  if (pendingAdvance) {
    audio.stopSpeaking();
    pendingAdvance();
    return true;
  }
  if (game && !game.finished && game.phase === "reading") {
    reveal();
    return true;
  }
  return false;
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
    if (settings.se) audio.sfx.key();
  } else {
    if (settings.se) audio.sfx.miss();
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
  if (settings.se) audio.sfx.clear();
  game.index++;
  game.typedDone = true;

  // 詠み上げが残っていれば、詠み終わるまで待ってから次の歌へ
  if (!game.recited) {
    el.readingLabel.firstChild.textContent = "詠み上げ中";
    el.readingNote.textContent = "Space で次の歌へ";
    el.reading.classList.remove("invisible");
  }
  pendingAdvance = advanceNow;
  advanceTimer = setTimeout(advanceNow, game.recited ? 260 : 25000);
  maybeAdvance();
}

/** 打ち終わりと詠み終わりがそろったら次の歌へ */
function maybeAdvance() {
  if (game && !game.finished && game.typedDone && game.recited) advanceNow();
}

function advanceNow() {
  clearTimeout(advanceTimer);
  pendingAdvance = null;
  highlightPhrase(-1);
  highlightShimoPhrase(-1);
  el.reading.classList.add("invisible");
  if (!game || game.finished) return;
  if (game.index >= game.poems.length) finishGame();
  else loadPoem();
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
  clearTimeout(advanceTimer);
  pendingAdvance = null;
  audio.stopSpeaking();
  highlightPhrase(-1);
  highlightShimoPhrase(-1);
  if (settings.se) audio.sfx.finish();
  clearTimeout(revealTimer);
  el.reading.classList.add("invisible");
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
    meta.textContent = `${kimarijiText(entry.poem)}（${kimarijiLabel(entry.poem)}） / ${entry.seconds.toFixed(1)}秒 / ミス${entry.miss}`;
    li.append(b, meta);
    list.append(li);
  }

  show("result");
  renderBest();
}

function quitGame() {
  clearInterval(tick);
  clearTimeout(revealTimer);
  clearTimeout(advanceTimer);
  pendingAdvance = null;
  audio.stopSpeaking();
  highlightPhrase(-1);
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
    else if (playing && skipAhead()) e.preventDefault();
    return;
  }
  if (!playing || !game || game.finished) return;

  if (e.key === " " || e.key === "Spacebar") {
    if (skipAhead()) e.preventDefault();
    return;
  }

  // ソフトキーボードは keydown で文字が取れない（229 や Unidentified になる）。
  // その場合は下の input で拾うので、ここでは何もしない。
  if (e.isComposing || e.keyCode === 229 || e.key === "Unidentified") return;
  if (e.key.length !== 1) return;
  if (!/^[a-zA-Z0-9,.\-']$/.test(e.key)) return;
  e.preventDefault();
  el.imeWarn.hidden = true;
  handleKey(e.key);
});

/**
 * ソフトキーボードからの入力を拾う。
 * 物理キーボードで打った文字は keydown 側で preventDefault しているので
 * ここには流れてこない。日本語が入ってきたら入力方式の案内を出す。
 */
el.capture.addEventListener("input", (e) => {
  const value = el.capture.value;
  if (e.isComposing) {
    el.imeWarn.hidden = false;
    return;
  }
  el.capture.value = "";
  if (!value) return;
  if (el.screens.play.hidden || !game || game.finished) return;

  let unsupported = false;
  for (const ch of value) {
    if (ch === " ") skipAhead();
    else if (/^[a-zA-Z0-9,.\-']$/.test(ch)) handleKey(ch);
    else if (ch !== "\n") unsupported = true;
  }
  el.imeWarn.hidden = !unsupported;
});

el.capture.addEventListener("compositionend", () => {
  // 変換された文字は受け取らずに捨てる（ローマ字入力に戻してもらう）
  el.capture.value = "";
  el.imeWarn.hidden = false;
});

// 画面のどこかを触ったら入力欄に焦点を戻す（スマートフォンでキーボードが引っ込んだとき用）。
// 既定の動作で焦点が外れたあとに当て直したいので click を使う。
el.screens.play.addEventListener("click", (e) => {
  if (e.target.closest("button, a, input")) return; // ボタン操作の邪魔をしない
  focusCapture();
});

/* ── 起動 ─────────────────────────────────── */
bindChoices("choice-count", "count", renderBest);
bindChoices("choice-order", "order", renderBest);
bindChoices("choice-wait", "wait", renderBest);
bindToggles("choice-sound");
bindToggles("choice-extra");
bindChoices("choice-rate", "rate");
$("btn-try-voice").addEventListener("click", tryVoice);
bindChoices("choice-level", "level", renderBest);
$("btn-start").addEventListener("click", startGame);
$("btn-again").addEventListener("click", startGame);
$("btn-home").addEventListener("click", quitGame);
$("btn-quit").addEventListener("click", quitGame);
$("btn-keyboard").addEventListener("click", (e) => {
  e.preventDefault();
  focusCapture();
});
$("btn-mute").addEventListener("click", () => {
  const on = settings.voice || settings.se;
  settings.voice = settings.se = !on;
  if (!settings.voice) {
    audio.stopSpeaking();
    highlightPhrase(-1);
  }
  saveSettings();
  updateMuteButton();
  updateVoiceNotice();
  for (const btn of $("choice-sound").querySelectorAll(".choice")) {
    btn.setAttribute("aria-checked", String(Boolean(settings[btn.dataset.key])));
  }
  focusCapture();
});
renderBest();
renderVoiceSetting();
updateVoiceNotice();
updateMuteButton();
// 音声一覧は非同期に読み込まれることがある
if (typeof speechSynthesis !== "undefined") {
  speechSynthesis.addEventListener?.("voiceschanged", () => {
    renderVoiceSetting();
    updateVoiceNotice();
  });
}
