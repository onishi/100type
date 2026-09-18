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

/** 1 トークン分の入力候補（前の候補ほど優先＝ヒント表示に使う） */
function optionsAt(seq, i) {
  const token = seq[i];
  const next = seq[i + 1];
  if (token !== SOKUON) return optionsOf(token, next);
  // 促音は次の音の子音を重ねる。「った」なら t + ta。
  const heads = [];
  if (next && next !== SOKUON && next !== HATSUON) {
    for (const opt of optionsOf(next, seq[i + 2])) {
      const head = opt[0];
      if (!"aiueo".includes(head) && !heads.includes(head)) heads.push(head);
    }
  }
  return [...heads, "ltu", "xtu", "ltsu", "xtsu"];
}

/** トークン列の先頭 length 個を、ローマ字の全候補に展開する */
function expandRun(seq, length) {
  let results = [""];
  for (let i = 0; i < length; i++) {
    const options = optionsAt(seq, i);
    const next = [];
    for (const prefix of results) {
      for (const option of options) next.push(prefix + option);
    }
    results = next.length > 96 ? next.slice(0, 96) : next;
  }
  return results;
}

/** 旧仮名・新仮名のトークン列を突き合わせて、一致部分と相違部分に分ける */
function diffTokens(oldTokens, newTokens) {
  const n = oldTokens.length;
  const m = newTokens.length;
  const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        oldTokens[i] === newTokens[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const ops = [];
  const push = (type, oldStart, oldEnd, newStart, newEnd) => {
    const last = ops[ops.length - 1];
    if (last && last.type === type && type === "replace") {
      last.oldEnd = oldEnd;
      last.newEnd = newEnd;
    } else {
      ops.push({ type, oldStart, oldEnd, newStart, newEnd });
    }
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldTokens[i] === newTokens[j]) {
      push("equal", i, i + 1, j, j + 1);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push("replace", i, i + 1, j, j);
      i++;
    } else {
      push("replace", i, i, j, j + 1);
      j++;
    }
  }
  if (i < n || j < m) push("replace", i, n, j, m);

  // 片側が空の相違部分は、隣の一致部分を巻き込んで両側を埋める
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k];
    if (op.type !== "replace") continue;
    if (op.oldEnd > op.oldStart && op.newEnd > op.newStart) continue;
    const prev = ops[k - 1];
    const nextOp = ops[k + 1];
    if (prev && prev.type === "equal") {
      op.oldStart = prev.oldStart;
      op.newStart = prev.newStart;
      ops.splice(k - 1, 1);
      k--;
    } else if (nextOp && nextOp.type === "equal") {
      op.oldEnd = nextOp.oldEnd;
      op.newEnd = nextOp.newEnd;
      ops.splice(k + 1, 1);
    } else {
      // 埋めようがない場合は一致部分として扱う（全体が空のときだけ）
      op.type = "equal";
    }
  }
  return ops;
}

/**
 * チャンクごとの入力候補を組み立てる。
 * modernKana を渡すと、旧仮名・新仮名のどちらの表記でも打てるようになる。
 */
export function buildChunks(kana, modernKana) {
  const tokens = tokenize(kana);
  if (!modernKana) {
    return tokens.map((token, i) => ({ kana: token, options: optionsAt(tokens, i) }));
  }

  const modernTokens = tokenize(modernKana);
  const chunks = [];
  for (const op of diffTokens(tokens, modernTokens)) {
    if (op.type === "equal") {
      for (let i = op.oldStart; i < op.oldEnd; i++) {
        chunks.push({ kana: tokens[i], options: optionsAt(tokens, i) });
      }
      continue;
    }
    // 表記が違う部分は一塊にして、旧仮名の候補と新仮名の候補を両方受け付ける
    const oldRun = tokens.slice(op.oldStart, op.oldEnd);
    const newRun = modernTokens.slice(op.newStart, op.newEnd);
    const tail = tokens.slice(op.oldEnd);
    const options = [
      ...expandRun([...oldRun, ...tail], oldRun.length),
      ...expandRun([...newRun, ...tail], newRun.length),
    ];
    chunks.push({ kana: oldRun.join(""), options: [...new Set(options)] });
  }
  return chunks;
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
 * modernKana を渡すと、旧仮名・新仮名のどちらの表記でも打てる。
 */
export class TypingTarget {
  constructor(kana, modernKana) {
    this.kana = kana;
    this.chunks = buildChunks(kana, modernKana);
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

  /**
   * 表示用のローマ字全体（確定済み + これから打つ分）。
   * 打ち方が複数あるときは、その歌の表記どおりの候補（各チャンクの第一候補）を優先する。
   * 途中で表示が入れ替わらないよう、候補の短さより優先順位を先に見る。
   */
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
      const better =
        best === null ||
        s.oi < best.oi ||
        (s.oi === best.oi && rest.length < best.rest.length);
      if (better) best = { oi: s.oi, rest };
    }
    return this.typed + (best ? best.rest : "");
  }

  /** 標準的なローマ字表記（最短候補） */
  static canonical(kana) {
    return buildChunks(kana)
      .map((c) => c.options[0])
      .join("");
  }
}
