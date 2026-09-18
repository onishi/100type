// 決まり字 — 上の句を頭から何文字聞けば、その歌と分かるか。
// データとして持たず、100 首の読みから計算する。
// 表示どおりの読み（歴史的仮名遣い）と、詠み上げの音（現代仮名遣い）の
// 両方で見分けがつく長さを採る。「をぐらやま」は字では一字だが、
// 音では「おぐ」まで聞かないと「おくやまに」などと区別できない。
import { POEMS } from "./data/poems.js";

const LABELS = ["", "一字", "二字", "三字", "四字", "五字", "六字", "七字", "八字"];

function strip(text) {
  return text.replace(/\s+/g, "");
}

/** その読みで、他の 99 首と区別がつく最短の長さ */
function uniqueLength(list, index) {
  const target = list[index];
  for (let n = 1; n <= target.length; n++) {
    const prefix = target.slice(0, n);
    if (list.every((other, i) => i === index || !other.startsWith(prefix))) return n;
  }
  return target.length;
}

function computeLengths() {
  const written = POEMS.map((p) => strip(p.kamiKana));
  const spoken = POEMS.map((p) => strip(p.kamiSpeech));
  return POEMS.map((_, i) =>
    Math.max(uniqueLength(written, i), uniqueLength(spoken, i))
  );
}

const LENGTHS = computeLengths();
const BY_NUMBER = new Map(POEMS.map((poem, i) => [poem.n, LENGTHS[i]]));

/** 決まり字の文字数 */
export function kimarijiLength(poem) {
  return BY_NUMBER.get(poem.n) ?? 0;
}

/** 決まり字そのもの（表示どおりの読みから取る） */
export function kimarijiText(poem) {
  return strip(poem.kamiKana).slice(0, kimarijiLength(poem));
}

/** 「三字決まり」のような呼び名 */
export function kimarijiLabel(poem) {
  const length = kimarijiLength(poem);
  return `${LABELS[length] ?? length}決まり`;
}

/** 何字決まりが何首あるか（テスト用） */
export function kimarijiDistribution() {
  const dist = {};
  for (const length of LENGTHS) dist[length] = (dist[length] ?? 0) + 1;
  return dist;
}
