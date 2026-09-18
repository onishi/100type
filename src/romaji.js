// かな → ローマ字入力エンジン
// 「し」を shi / si / ci、「ん」を n / nn / xn のように、複数のローマ字入力を受け付ける。
// かなを「チャンク」に分解し、各チャンクの入力候補を並列に追跡する NFA として実装する。

const KANA = {
  "あ": ["a"], "い": ["i", "yi"], "う": ["u", "wu", "whu"], "え": ["e"], "お": ["o"],
  "か": ["ka", "ca"], "き": ["ki"], "く": ["ku", "cu", "qu"], "け": ["ke"], "こ": ["ko", "co"],
  "が": ["ga"], "ぎ": ["gi"], "ぐ": ["gu"], "げ": ["ge"], "ご": ["go"],
  "さ": ["sa"], "し": ["shi", "si", "ci"], "す": ["su"], "せ": ["se", "ce"], "そ": ["so"],
  "ざ": ["za"], "じ": ["ji", "zi"], "ず": ["zu"], "ぜ": ["ze"], "ぞ": ["zo"],
  "た": ["ta"], "ち": ["chi", "ti"], "つ": ["tsu", "tu"], "て": ["te"], "と": ["to"],
  "だ": ["da"], "ぢ": ["di"], "づ": ["du"], "で": ["de"], "ど": ["do"],
  "な": ["na"], "に": ["ni"], "ぬ": ["nu"], "ね": ["ne"], "の": ["no"],
  "は": ["ha"], "ひ": ["hi"], "ふ": ["fu", "hu"], "へ": ["he"], "ほ": ["ho"],
  "ば": ["ba"], "び": ["bi"], "ぶ": ["bu"], "べ": ["be"], "ぼ": ["bo"],
  "ぱ": ["pa"], "ぴ": ["pi"], "ぷ": ["pu"], "ぺ": ["pe"], "ぽ": ["po"],
  "ま": ["ma"], "み": ["mi"], "む": ["mu"], "め": ["me"], "も": ["mo"],
  "や": ["ya"], "ゆ": ["yu"], "よ": ["yo"],
  "ら": ["ra"], "り": ["ri"], "る": ["ru"], "れ": ["re"], "ろ": ["ro"],
  "わ": ["wa"], "ゐ": ["wi"], "ゑ": ["we"], "を": ["wo"],
  "ゔ": ["vu"],
  "ぁ": ["la", "xa"], "ぃ": ["li", "xi"], "ぅ": ["lu", "xu"], "ぇ": ["le", "xe"], "ぉ": ["lo", "xo"],
  "ゃ": ["lya", "xya"], "ゅ": ["lyu", "xyu"], "ょ": ["lyo", "xyo"], "ゎ": ["lwa", "xwa"],
  "きゃ": ["kya"], "きゅ": ["kyu"], "きょ": ["kyo"], "きぇ": ["kye"], "きぃ": ["kyi"],
  "ぎゃ": ["gya"], "ぎゅ": ["gyu"], "ぎょ": ["gyo"], "ぎぇ": ["gye"],
  "しゃ": ["sha", "sya"], "しゅ": ["shu", "syu"], "しょ": ["sho", "syo"], "しぇ": ["she", "sye"],
  "じゃ": ["ja", "zya", "jya"], "じゅ": ["ju", "zyu", "jyu"], "じょ": ["jo", "zyo", "jyo"], "じぇ": ["je", "zye", "jye"],
  "ちゃ": ["cha", "tya", "cya"], "ちゅ": ["chu", "tyu", "cyu"], "ちょ": ["cho", "tyo", "cyo"], "ちぇ": ["che", "tye", "cye"],
  "ぢゃ": ["dya"], "ぢゅ": ["dyu"], "ぢょ": ["dyo"],
  "にゃ": ["nya"], "にゅ": ["nyu"], "にょ": ["nyo"],
  "ひゃ": ["hya"], "ひゅ": ["hyu"], "ひょ": ["hyo"],
  "びゃ": ["bya"], "びゅ": ["byu"], "びょ": ["byo"],
  "ぴゃ": ["pya"], "ぴゅ": ["pyu"], "ぴょ": ["pyo"],
  "みゃ": ["mya"], "みゅ": ["myu"], "みょ": ["myo"],
  "りゃ": ["rya"], "りゅ": ["ryu"], "りょ": ["ryo"],
  "てぃ": ["thi"], "てゅ": ["thu"], "でぃ": ["dhi"], "でゅ": ["dhu"],
  "とぅ": ["twu"], "どぅ": ["dwu"],
  "ふぁ": ["fa"], "ふぃ": ["fi"], "ふぇ": ["fe"], "ふぉ": ["fo"], "ふゅ": ["fyu"],
  "うぁ": ["wha"], "うぃ": ["wi", "whi"], "うぇ": ["we", "whe"], "うぉ": ["who"],
  "ゔぁ": ["va"], "ゔぃ": ["vi"], "ゔぇ": ["ve"], "ゔぉ": ["vo"],
  "ー": ["-"], "、": [","], "。": ["."],
};

const SOKUON = "っ";
const HATSUON = "ん";
const SMALL_KANA = "ぁぃぅぇぉゃゅょゎ";
// 「ん」を一文字の n で確定できない後続音（な行・や行・母音・ん）
const N_BLOCKERS = /^[aiueony]/;

/** かな文字列を拗音・促音・撥音を考慮したチャンク配列に分解する */
export function tokenize(kana) {
  const src = kana.replace(/\s+/g, "");
  const tokens = [];
  for (let i = 0; i < src.length; i++) {
    const two = src.slice(i, i + 2);
    if (two.length === 2 && SMALL_KANA.includes(two[1]) && KANA[two]) {
      tokens.push(two);
      i++;
    } else {
      tokens.push(src[i]);
    }
  }
  return tokens;
}

/** チャンクごとの入力候補（前の候補ほど優先＝ヒント表示に使う） */
export function buildChunks(kana) {
  const tokens = tokenize(kana);
  return tokens.map((token, i) => {
    const next = tokens[i + 1];
    let options;
    if (token === SOKUON) {
      const heads = [];
      if (next && next !== SOKUON && next !== HATSUON) {
        for (const opt of optionsOf(next, tokens[i + 2])) {
          const head = opt[0];
          if (!"aiueo".includes(head) && !heads.includes(head)) heads.push(head);
        }
      }
      options = [...heads, "ltu", "xtu", "ltsu", "xtsu"];
    } else {
      options = optionsOf(token, next);
    }
    return { kana: token, options };
  });
}

function optionsOf(token, next) {
  if (token === HATSUON) {
    const opts = ["nn", "xn", "n'"];
    const nextOptions = next === SOKUON ? null : KANA[next];
    const canShorten =
      !next ||
      (nextOptions ? nextOptions.every((o) => !N_BLOCKERS.test(o)) : false);
    return canShorten ? ["n", ...opts] : opts;
  }
  return KANA[token] || [token];
}

/**
 * 1首分のタイピング判定。
 * 生きている状態（チャンク位置・候補・候補内オフセット）の集合を保持する。
 */
export class TypingTarget {
  constructor(kana) {
    this.kana = kana;
    this.chunks = buildChunks(kana);
    this.typed = "";
    this.missCount = 0;
    this.states = this.chunks.length ? [{ ci: 0, oi: 0, pos: 0 }] : [];
    this.states = this.expand([{ ci: 0, pos: 0 }]);
    this.done = this.chunks.length === 0;
  }

  /** チャンク境界の状態を、各候補の先頭へ展開する */
  expand(positions) {
    const out = [];
    const seen = new Set();
    for (const p of positions) {
      if (p.ci >= this.chunks.length) continue;
      this.chunks[p.ci].options.forEach((_, oi) => {
        const key = `${p.ci}:${oi}:0`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ ci: p.ci, oi, pos: 0 });
        }
      });
    }
    return out;
  }

  /** 1文字入力。受理できれば true、ミスなら false */
  input(ch) {
    if (this.done) return false;
    const key = ch.toLowerCase();
    const advanced = [];
    const boundary = [];
    for (const s of this.states) {
      const opt = this.chunks[s.ci].options[s.oi];
      if (opt[s.pos] !== key) continue;
      if (s.pos + 1 === opt.length) boundary.push({ ci: s.ci + 1, pos: 0 });
      else advanced.push({ ci: s.ci, oi: s.oi, pos: s.pos + 1 });
    }
    if (!advanced.length && !boundary.length) {
      this.missCount++;
      return false;
    }
    this.typed += key;
    if (boundary.some((b) => b.ci >= this.chunks.length)) {
      this.states = [];
      this.done = true;
      return true;
    }
    this.states = [...advanced, ...this.expand(boundary)];
    return true;
  }

  /** 確定済みのかな文字数（ハイライト用） */
  confirmedKanaLength() {
    if (this.done) return this.kana.replace(/\s+/g, "").length;
    const minCi = Math.min(...this.states.map((s) => s.ci));
    return this.chunks.slice(0, minCi).reduce((n, c) => n + c.kana.length, 0);
  }

  /** 表示用のローマ字全体（確定済み + これから打つ分） */
  hint() {
    if (this.done) return this.typed;
    let best = null;
    for (const s of this.states) {
      const opt = this.chunks[s.ci].options[s.oi];
      const rest =
        opt.slice(s.pos) +
        this.chunks
          .slice(s.ci + 1)
          .map((c) => c.options[0])
          .join("");
      if (best === null || rest.length < best.length) best = rest;
    }
    return this.typed + (best ?? "");
  }

  /** 標準的なローマ字表記（最短候補） */
  static canonical(kana) {
    return buildChunks(kana)
      .map((c) => c.options[0])
      .join("");
  }
}
