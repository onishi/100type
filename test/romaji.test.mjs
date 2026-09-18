import test from "node:test";
import assert from "node:assert/strict";
import { TypingTarget, tokenize } from "../src/romaji.js";
import { POEMS } from "../src/data/poems.js";

function typeAll(kana, input, modern, sound) {
  const t = new TypingTarget(kana, modern, sound);
  for (const ch of input) t.input(ch);
  return t;
}

function target(poem) {
  return new TypingTarget(poem.shimoKana, poem.shimoModern, poem.shimoSound);
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

test("旧仮名・新仮名・発音どおりのどれでも打ち切れる", () => {
  for (const p of POEMS) {
    for (const kana of [p.shimoKana, p.shimoModern, p.shimoSound]) {
      const input = TypingTarget.canonical(kana);
      const t = typeAll(p.shimoKana, input, p.shimoModern, p.shimoSound);
      assert.ok(t.done, `${p.n}: ${kana} / ${input}`);
      assert.equal(t.missCount, 0, `${p.n}: ${kana} / ${input}`);
    }
  }
});

test("助詞の「は」は wa でも ha でも打てる", () => {
  const cases = [
    [1, "wagakoromodewatsuyuninuretsutsu"],
    [1, "wagakoromodehatsuyuninuretsutsu"],
    [53, "ikanihisashikimonotokawashiru"],
    [58, "idesoyohitoowasureyawasuru"],
    [74, "hageshikaretowainoranumonoo"],
    [99, "yooomouyuenimonoomoumiwa"],
  ];
  for (const [n, input] of cases) {
    const p = POEMS[n - 1];
    const t = typeAll(p.shimoKana, input, p.shimoModern, p.shimoSound);
    assert.ok(t.done, `${n} <- ${input}`);
    assert.equal(t.missCount, 0, `${n} <- ${input}`);
  }
});

test("助詞でない「は」は wa では打てない", () => {
  const cases = [
    [35, "wanazomukashinokaninioikeru"], // 花ぞ昔の
    [74, "wageshikaretowainoranumonoo"], // はげしかれ
    [60, "madafumimimizuamanowashidate"], // 天の橋立
    [29, "okimadowaserushiragikunowana"], // 白菊の花
  ];
  for (const [n, input] of cases) {
    const p = POEMS[n - 1];
    const t = typeAll(p.shimoKana, input, p.shimoModern, p.shimoSound);
    assert.ok(!t.done, `${n} は wa で打ててしまった: ${input}`);
  }
});

test("表示は旧仮名のまま（ヒントは歌の表記に従う）", () => {
  for (const p of POEMS) {
    const t = target(p);
    assert.equal(t.hint(), TypingTarget.canonical(p.shimoKana), `${p.n}`);
  }
});

test("新旧の表記ゆれの例", () => {
  const cases = [
    ["ころもほすてふ", "ころもほすちょう", ["koromohosutefu", "koromohosuchou"]],
    ["けふをかぎりの", "きょうをかぎりの", ["kefuwokagirino", "kyouwokagirino"]],
    ["しるもしらぬも あふさかのせき", "しるもしらぬも おうさかのせき",
      ["shirumoshiranumoafusakanoseki", "shirumoshiranumoousakanoseki"]],
    ["ひとりかもねむ", "ひとりかもねん", ["hitorikamonemu", "hitorikamonen"]],
    ["みのいたづらに", "みのいたずらに", ["minoitadurani", "minoitazurani"]],
    ["こひぞつもりて", "こいぞつもりて", ["kohizotsumorite", "koizotsumorite"]],
    ["からくれなゐに", "からくれないに", ["karakurenawini", "karakurenaini"]],
  ];
  for (const [kana, modern, inputs] of cases) {
    for (const input of inputs) {
      const t = typeAll(kana, input, modern);
      assert.ok(t.done, `${kana} <- ${input}`);
      assert.equal(t.missCount, 0, `${kana} <- ${input}`);
    }
  }
});

test("読み上げ用の現代仮名が全首そろっている", () => {
  for (const p of POEMS) {
    assert.match(p.kamiSpeech, /^[ぁ-んー 　]+$/u, `${p.n}`);
    assert.equal(p.kamiSpeech.split(/\s+/).length, 3, `${p.n}: 五七五に分かれていない`);
    assert.match(p.shimoModern, /^[ぁ-んー 　]+$/u, `${p.n}`);
    assert.equal(
      p.shimoModern.split(/\s+/).length,
      p.shimoKana.split(/\s+/).length,
      `${p.n}: 句の数が旧仮名と合わない`
    );
    assert.match(p.shimoSound, /^[ぁ-んー 　]+$/u, `${p.n}`);
    assert.equal(
      tokenize(p.shimoSound).length,
      tokenize(p.shimoModern).length,
      `${p.n}: 発音どおりの表記の長さが新仮名と合わない`
    );
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
