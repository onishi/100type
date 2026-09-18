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

/** 日本語の音声があれば返す */
export function japaneseVoice() {
  if (!synth) return null;
  if (!voices.length) loadVoices();
  const ja = voices.filter((v) => (v.lang || "").toLowerCase().startsWith("ja"));
  if (!ja.length) return null;
  // ローカル再生できる音声を優先する（オフラインでも鳴る）
  return ja.find((v) => v.localService) || ja[0];
}

export function speechAvailable() {
  return Boolean(japaneseVoice());
}

/**
 * 上の句を読み上げる。読み上げを始められたら true。
 * @param {string} text 現代仮名遣いの読み
 * @param {() => void} onEnd 読み終わり（失敗時も呼ぶ）
 */
export function speak(text, onEnd) {
  const voice = japaneseVoice();
  if (!synth || !voice) return false;
  try {
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = voice.lang || "ja-JP";
    try {
      utterance.voice = voice;
    } catch {
      /* 音声を直接指定できない環境では lang 指定にまかせる */
    }
    utterance.rate = 0.85; // 詠み札のようにゆっくり
    utterance.pitch = 0.95;
    utterance.onend = () => onEnd?.();
    utterance.onerror = () => onEnd?.();
    synth.speak(utterance);
    return true;
  } catch {
    return false;
  }
}

export function stopSpeaking() {
  try {
    synth?.cancel();
  } catch {
    /* 対応していないブラウザでは何もしない */
  }
}
