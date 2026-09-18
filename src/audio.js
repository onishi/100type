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

// 声の好み。詠み上げに向く、落ち着いた日本語音声を先に選ぶ。
const VOICE_PREFERENCE = ["Google 日本語", "Kyoko", "O-Ren", "Otoya", "Nanami", "Ayumi", "Haruka", "Hattori", "Ichiro"];

/** 使える日本語の音声を一覧で返す */
export function japaneseVoices() {
  if (!synth) return [];
  if (!voices.length) loadVoices();
  return voices.filter((v) => (v.lang || "").toLowerCase().startsWith("ja"));
}

/** 日本語の音声があれば返す（name を指定すればその声を優先） */
export function japaneseVoice(name) {
  const ja = japaneseVoices();
  if (!ja.length) return null;
  if (name) {
    const chosen = ja.find((v) => v.name === name);
    if (chosen) return chosen;
  }
  for (const key of VOICE_PREFERENCE) {
    const hit = ja.find((v) => (v.name || "").includes(key));
    if (hit) return hit;
  }
  return ja.find((v) => v.localService) || ja[0];
}

export function speechAvailable() {
  return Boolean(japaneseVoice());
}

const PHRASE_GAP_MS = 420; // 句のあいだに置く間
export const DEFAULT_RATE = 0.8;
const FINAL_PHRASE_RATE = 0.9; // 結びの句は少しゆっくり読む
let speechSeq = 0;

/** onend が来ないブラウザでも止まらないよう、読み終わりの見込み時間を出す */
function estimateMs(text, rate) {
  return Math.round((text.length * 200) / Math.max(rate, 0.3)) + 1500;
}

/**
 * 歌を句ごとに区切って読み上げる。読み上げを始められたら true。
 * @param {string} text 空白で句に区切った読み
 * @param {{ onPhrase?: (index: number) => void, onEnd?: () => void,
 *           rate?: number, voiceName?: string }} options
 */
export function speak(text, { onPhrase, onEnd, rate = DEFAULT_RATE, voiceName } = {}) {
  const voice = japaneseVoice(voiceName);
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

  const speakPhrase = (i) => {
    if (!alive()) return;
    if (i >= phrases.length) {
      onPhrase?.(-1);
      onEnd?.();
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
  setTimeout(() => speakPhrase(0), 120);
  return true;
}

export function stopSpeaking() {
  speechSeq++; // 途中の句が続かないようにする
  try {
    synth?.cancel();
  } catch {
    /* 対応していないブラウザでは何もしない */
  }
}
