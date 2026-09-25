import assert from "node:assert/strict";
import test from "node:test";
import { PhotoInbox } from "../packages/core/src/inbox.ts";

void test("take()は上限を超えない枚数を受信順に返し、残りを受信箱に残す", () => {
  const inbox = new PhotoInbox();
  // base64で各8文字になる6バイトの画像を3枚。
  for (const byte of [1, 2, 3]) inbox.add(new Uint8Array(6).fill(byte), "image/png");

  const first = inbox.take(16);
  assert.equal(first.length, 2);
  assert.equal(Buffer.from(first[0]!.data, "base64")[0], 1);
  assert.equal(inbox.pending.length, 1);

  // 1枚目が上限を超えても、その1枚は返す。
  assert.equal(inbox.take(1).length, 1);
  assert.equal(inbox.pending.length, 0);
});

void test("take()は上限を指定しなければ全部返す", () => {
  const inbox = new PhotoInbox();
  for (let index = 0; index < 3; index++) inbox.add(new Uint8Array(6), "image/png");
  assert.equal(inbox.take().length, 3);
  assert.equal(inbox.take().length, 0);
});
