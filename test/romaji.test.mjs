import test from "node:test";
import assert from "node:assert/strict";
import { TypingTarget, tokenize } from "../src/romaji.js";
import { POEMS } from "../src/data/poems.js";

function typeAll(kana, input) {
  const t = new TypingTarget(kana);
  for (const ch of input) t.input(ch);
  return t;
}

test("拗音・促音をチャンク化する", () => {
  assert.deepEqual(tokenize("きょうはっきり"), ["きょ", "う", "は", "っ", "き", "り"]);
});

test("標準のローマ字で打ち切れる", () => {
  for (const p of POEMS) {
    const t = typeAll(p.shimoKana, TypingTarget.canonical(p.shimoKana));
    assert.ok(t.done, `${p.n}: ${p.shimoKana} / ${TypingTarget.canonical(p.shimoKana)}`);
    assert.equal(t.missCount, 0);
  }
});

test("hint() のローマ字でも打ち切れる", () => {
  for (const p of POEMS) {
    const t = new TypingTarget(p.shimoKana);
    let guard = 0;
    while (!t.done && guard++ < 200) {
      const rest = t.hint().slice(t.typed.length);
      assert.ok(t.input(rest[0]), `${p.n} ${t.typed}|${rest}`);
    }
    assert.ok(t.done, `${p.n}`);
  }
});

test("複数のローマ字入力を受け付ける", () => {
  const cases = [
    ["しづごころなく", "shidugokoronaku"],
    ["しづごころなく", "sidzugokoronaku".replace("dzu", "du")],
    ["つゆにぬれつつ", "tuyuninuretutu"],
    ["つゆにぬれつつ", "tsuyuninuretsutsu"],
    ["ふじのたかねに", "fujinotakaneni"],
    ["ふじのたかねに", "huzinotakaneni"],
    ["からくれなゐに", "karakurenawini"],
    ["けふここのへに", "kefukokonoheni"],
  ];
  for (const [kana, input] of cases) {
    const t = typeAll(kana, input);
    assert.ok(t.done, `${kana} <- ${input}`);
    assert.equal(t.missCount, 0, `${kana} <- ${input}`);
  }
});

test("促音は子音の重ねでも ltu でも打てる", () => {
  assert.ok(typeAll("まって", "matte").done);
  assert.ok(typeAll("まって", "maltute").done);
  assert.ok(typeAll("まって", "maxtsute").done);
});

test("撥音は n / nn の両方、母音前は nn のみ", () => {
  assert.ok(typeAll("かんぱい", "kanpai").done);
  assert.ok(typeAll("かんぱい", "kannpai").done);
  const bad = typeAll("ほんや", "honya");
  assert.ok(!bad.done);
  assert.ok(typeAll("ほんや", "honnya").done);
});

test("ミスタイプはカウントされ入力は進まない", () => {
  const t = new TypingTarget("あき");
  assert.ok(!t.input("k"));
  assert.equal(t.missCount, 1);
  assert.equal(t.typed, "");
  assert.ok(t.input("a"));
  assert.equal(t.confirmedKanaLength(), 1);
});
