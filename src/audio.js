// 音まわり：上の句の読み上げ（Web Speech API）と、打鍵音（Web Audio API）。
// 音声ファイルは持たず、すべてブラウザ側で合成する。

/* ── 効果音 ───────────────────────────────── */
let ctx = null;

function context() {
  if (!ctx) {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return null;
    try {
      ctx = new AudioCtor();
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

/** 最初のユーザー操作で音を鳴らせる状態にしておく */
export function unlock() {
  context();
}

function tone({ freq, dur = 0.08, type = "sine", gain = 0.06, glide = null, delay = 0 }) {
  const ac = context();
  if (!ac) return;
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const env = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (glide) osc.frequency.exponentialRampToValueAtTime(glide, t0 + dur);
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(env).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

export const sfx = {
  key: () => tone({ freq: 1320, dur: 0.035, type: "triangle", gain: 0.03 }),
  miss: () => tone({ freq: 190, glide: 110, dur: 0.16, type: "sawtooth", gain: 0.06 }),
  clear: () => {
    // 一首打ち終えたときの、鈴のような二音
    tone({ freq: 1318.5, dur: 0.5, gain: 0.05 });
    tone({ freq: 1975.5, dur: 0.42, gain: 0.03, delay: 0.04 });
  },
  finish: () => {
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) =>
      tone({ freq, dur: 0.55, gain: 0.045, delay: i * 0.13 })
    );
  },
};

/* ── 読み上げ ─────────────────────────────── */
const synth = typeof speechSynthesis !== "undefined" ? speechSynthesis : null;
let voices = [];

function loadVoices() {
  if (!synth) return;
  voices = synth.getVoices() || [];
}

if (synth) {
  loadVoices();
  synth.addEventListener?.("voiceschanged", loadVoices);
}

// 詠み手は Kyoko。入っていない環境では、ある日本語音声で代用する。
const VOICE_NAME = "Kyoko";

/** 使える日本語の音声を一覧で返す */
export function japaneseVoices() {
  if (!synth) return [];
  if (!voices.length) loadVoices();
  return voices.filter((v) => (v.lang || "").toLowerCase().startsWith("ja"));
}

/** 詠み手の声を返す（Kyoko があればそれ、なければ手近な日本語音声） */
export function japaneseVoice() {
  const ja = japaneseVoices();
  if (!ja.length) return null;
  return (
    ja.find((v) => (v.name || "").includes(VOICE_NAME)) ||
    ja.find((v) => v.localService) ||
    ja[0]
  );
}

export function speechAvailable() {
  return Boolean(japaneseVoice());
}

const PHRASE_GAP_MS = 420; // 句のあいだに置く間
const VERSE_GAP_MS = 700; // 上の句と下の句のあいだに置く間
export const DEFAULT_RATE = 0.8;
const FINAL_PHRASE_RATE = 0.9; // 結びの句は少しゆっくり読む
let speechSeq = 0;
let chainActive = false; // いま読み上げの途中かどうか
let queued = null; // 読み終わったあとに続けて読むもの

/** onend が来ないブラウザでも止まらないよう、読み終わりの見込み時間を出す */
function estimateMs(text, rate) {
  return Math.round((text.length * 200) / Math.max(rate, 0.3)) + 1500;
}

/**
 * 歌を句ごとに区切って読み上げる。読み上げを始められたら true。
 * queue を立てると、いま読んでいる途中なら、それを読み終えてから続けて読む
 * （上の句に続けて下の句を詠むのに使う）。
 * @param {string} text 空白で句に区切った読み
 * @param {{ onPhrase?: (index: number) => void, onEnd?: () => void,
 *           rate?: number, queue?: boolean }} options
 */
export function speak(text, options = {}) {
  if (!synth || !japaneseVoice()) return false;
  if (options.queue && chainActive) {
    queued = { text, options };
    return true;
  }
  return startChain(text, options, 120);
}

/**
 * 実際に読み始める。
 * @param {number} delay 読み始めるまでの待ち（cancel() 直後は少し置く必要がある）
 */
function startChain(text, { onPhrase, onEnd, rate = DEFAULT_RATE } = {}, delay = 120) {
  const voice = japaneseVoice();
  if (!synth || !voice) return false;
  const phrases = String(text).split(/[\s、]+/).filter(Boolean);
  if (!phrases.length) return false;

  const seq = ++speechSeq;
  const alive = () => seq === speechSeq;
  try {
    synth.cancel();
    synth.resume?.(); // 一時停止のまま固まっている環境への保険
  } catch {
    return false;
  }
  chainActive = true;

  const speakPhrase = (i) => {
    if (!alive()) return;
    if (i >= phrases.length) {
      chainActive = false;
      onPhrase?.(-1);
      onEnd?.();
      // 続けて読むものがあれば、少し間を置いてから読む
      if (queued && alive()) {
        const next = queued;
        queued = null;
        startChain(next.text, next.options, VERSE_GAP_MS);
      }
      return;
    }
    onPhrase?.(i);
    let advanced = false;
    const advance = () => {
      if (advanced || !alive()) return;
      advanced = true;
      clearTimeout(guard);
      setTimeout(() => speakPhrase(i + 1), i + 1 < phrases.length ? PHRASE_GAP_MS : 0);
    };
    const last = i === phrases.length - 1;
    const phraseRate = last ? rate * FINAL_PHRASE_RATE : rate;
    const guard = setTimeout(advance, estimateMs(phrases[i], phraseRate));
    try {
      const utterance = new SpeechSynthesisUtterance(phrases[i]);
      utterance.lang = voice.lang || "ja-JP";
      try {
        utterance.voice = voice;
      } catch {
        /* 音声を直接指定できない環境では lang 指定にまかせる */
      }
      utterance.rate = phraseRate;
      utterance.pitch = 0.95;
      utterance.onend = advance;
      utterance.onerror = advance;
      synth.speak(utterance);
    } catch {
      advance();
    }
  };

  // cancel() の直後に speak() すると鳴らないブラウザがあるので、少し置いてから始める
  setTimeout(() => speakPhrase(0), delay);
  return true;
}

export function stopSpeaking() {
  speechSeq++; // 途中の句が続かないようにする
  chainActive = false;
  queued = null;
  try {
    synth?.cancel();
  } catch {
    /* 対応していないブラウザでは何もしない */
  }
}
