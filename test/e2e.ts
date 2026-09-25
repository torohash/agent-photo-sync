import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve, extname } from "node:path";
import { setTimeout } from "node:timers/promises";
import { promisify, stripVTControlCharacters } from "node:util";
import { chromium, type Browser } from "playwright-core";
import type { ReceiverStatus } from "../packages/core/src/protocol.ts";

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const output = join(root, ".artifacts", `e2e-${Date.now()}`);
const socket = `photosync-${process.pid}`;
const tmux = (...args: string[]) =>
  execute("tmux", ["-L", socket, "-f", join(output, "tmux.conf"), ...args]);
const herdr = (...args: string[]) => execute("herdr", args);
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

async function waitUntil(
  predicate: () => Promise<boolean>,
  message: string,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await setTimeout(200);
  }
  assert.fail(message);
}

function pendingWidgetLayout(output: string): { rows: number; blankRows: number } {
  const lines = stripVTControlCharacters(output).split(/\r?\n/);
  const start = lines.findLastIndex((line) => line.trimStart().startsWith("Agent PhotoSync · 添付画像 "));
  assert.notEqual(start, -1, "未送信画像の枚数が表示されること");
  const border = lines.slice(start + 1).findIndex((line) => line.includes("────────"));
  assert.notEqual(border, -1, "表示の下に入力欄があること");
  const widget = lines.slice(start, start + border + 1);
  return { rows: widget.length, blankRows: widget.filter((line) => line.trim() === "").length };
}

await mkdir(output, { recursive: true });
await writeFile(
  join(output, "tmux.conf"),
  "set -g extended-keys on\nset -g extended-keys-format csi-u\n",
);
assert.equal(
  process.env.HERDR_ENV,
  "1",
  "Herdr内のシェルから実行してください。",
);
assert.ok(
  process.env.PHOTOSYNC_CHROME,
  "PHOTOSYNC_CHROMEにChromeの実行ファイルを指定してください。",
);
const webRoot = join(root, "apps/camera/build/web");
const contentTypes: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".otf": "font/otf",
  ".ttf": "font/ttf",
};
const web = createServer((request, response) => {
  const pathname = new URL(request.url!, "http://localhost").pathname;
  const file = join(webRoot, pathname === "/" ? "index.html" : pathname);
  void readFile(file)
    .then((bytes) => {
      response.writeHead(200, {
        "Content-Type":
          contentTypes[extname(file)] ?? "application/octet-stream",
      });
      response.end(bytes);
    })
    .catch((error: unknown) => {
      response.writeHead(404);
      response.end(String(error));
    });
});
await new Promise<void>((resolve) => web.listen(0, "127.0.0.1", resolve));
const webOrigin = `http://127.0.0.1:${(web.address() as AddressInfo).port}`;
let paneId: string | undefined;
let browser: Browser | undefined;
let tmuxStarted = false;

const piCommand = (name: string, outside: boolean) =>
  [
    "env",
    ...(outside
      ? [
          "-u HERDR_ENV",
          "-u HERDR_PANE_ID",
          "-u HERDR_TAB_ID",
          "-u HERDR_WORKSPACE_ID",
          "-u HERDR_SOCKET_PATH",
        ]
      : []),
    `PI_CODING_AGENT_DIR=${quote(join(output, "pi-home"))}`,
    `XDG_STATE_HOME=${quote(join(output, "state"))}`,
    `PHOTOSYNC_CAPTURE_FILE=${quote(join(output, `${name}-input.jsonl`))}`,
    "PI_OFFLINE=1",
    "pi --no-extensions --no-skills --no-prompt-templates --no-context-files --no-tools --no-themes --no-approve",
    `-e ${quote(join(root, "extensions/photosync.ts"))}`,
    `-e ${quote(join(root, "test/fixtures/capture-input.ts"))}`,
    ...(outside ? [`--photosync-web-origin ${quote(webOrigin)}`] : []),
  ].join(" ");

try {
  const created = JSON.parse(
    (
      await herdr(
        "pane",
        "split",
        "--current",
        "--direction",
        "right",
        "--cwd",
        root,
        "--no-focus",
      )
    ).stdout,
  );
  paneId = created.result.pane.pane_id;
  await herdr("pane", "run", paneId!, piCommand("herdr", false));
  await tmux(
    "new-session",
    "-d",
    "-s",
    "photosync",
    "-x",
    "160",
    "-y",
    "55",
    "-c",
    root,
    piCommand("tmux", true),
  );
  tmuxStarted = true;
  const readTmux = async () =>
    (await tmux("capture-pane", "-p", "-S", "-400", "-t", "photosync:0.0"))
      .stdout;
  const readHerdr = async () =>
    (
      await herdr(
        "pane",
        "read",
        paneId!,
        "--source",
        "recent-unwrapped",
        "--lines",
        "300",
        "--raw",
      )
    ).stdout;
  const sendTmux = async (text: string) => {
    await tmux("set-buffer", "-b", "photosync", text);
    await tmux(
      "paste-buffer",
      "-p",
      "-d",
      "-b",
      "photosync",
      "-t",
      "photosync:0.0",
    );
    await waitUntil(
      async () => (await readTmux()).includes(text),
      "Piの入力欄に文字が入ること",
    );
    await tmux("send-keys", "-t", "photosync:0.0", "Enter");
  };
  const sendHerdr = async (text: string) => {
    await herdr("pane", "run", paneId!, text);
  };
  await waitUntil(
    async () => (await readTmux()).includes("Agent PhotoSync"),
    "tmux内のPiが起動すること",
  );
  await waitUntil(
    async () => (await readHerdr()).includes("Agent PhotoSync"),
    "Herdr内のPiが起動すること",
  );
  await sendTmux("/photosync status");
  await sendHerdr("/photosync status");
  const localUrl = /このPCのWeb確認用: (http:\/\/127\.0\.0\.1:\d+)/;
  await waitUntil(
    async () =>
      localUrl.test(await readTmux()) && localUrl.test(await readHerdr()),
    "両方のPiが接続先を表示すること",
  );
  const tmuxUrl = (await readTmux()).match(localUrl)![1];
  const herdrUrl = (await readHerdr()).match(localUrl)![1];
  const status = async (url: string): Promise<ReceiverStatus> =>
    (await fetch(`${url}/v1/status`)).json();
  const [outside, inside] = await Promise.all([
    status(tmuxUrl),
    status(herdrUrl),
  ]);
  assert.equal(outside.herdr, null);
  assert.equal(inside.herdr!.paneId, paneId);
  assert.equal(outside.cwd, inside.cwd);
  assert.notEqual(outside.id, inside.id);
  await waitUntil(async () => {
    const peers = await (await fetch(`${tmuxUrl}/v1/peers`)).json();
    return peers.some((peer: { id: string }) => peer.id === inside.id);
  }, "Pi拡張同士がmDNSで発見されること");

  browser = await chromium.launch({
    executablePath: process.env.PHOTOSYNC_CHROME,
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage({
    viewport: { width: 1000, height: 1300 },
  });
  const errors: string[] = [];
  const metadataRequests: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "GET" && new URL(request.url()).pathname.startsWith("/v1/")) metadataRequests.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") console.error(message.text());
  });
  await page.goto(webOrigin);
  await page.getByRole("textbox", { name: "受信先の接続先URL" }).fill(herdrUrl);
  const deniedRequest = page.waitForEvent("requestfailed", (request) => request.url() === `${herdrUrl}/v1/events`);
  await page.getByRole("button", { name: "接続", exact: true }).click();
  await deniedRequest;
  await setTimeout(4000);
  assert.equal(metadataRequests.filter((url) => url === `${herdrUrl}/v1/events`).length, 1, "接続失敗を定期的に再試行しないこと");
  await sendHerdr(`/photosync web-origin ${webOrigin}`);
  await waitUntil(async () => (await fetch(`${herdrUrl}/v1/status`)).headers.get("access-control-allow-origin") === webOrigin, "起動中のPiでWeb接続を許可できること");
  await page.getByRole("button", { name: "接続", exact: true }).click();
  await page.locator(`[flt-semantics-identifier="receiver-${inside.id}"]`).click();
  const image = join(root, "test/fixtures/photo.png");
  async function upload(): Promise<void> {
    const chooser = page.waitForEvent("filechooser");
    await page
      .getByRole("button", { name: "画像ファイルを選んで送信", exact: true })
      .click();
    await (await chooser).setFiles(image);
  }
  await upload();
  await waitUntil(
    async () => (await status(herdrUrl)).pending === 1,
    "手動選択したPiに画像が届くこと",
  );
  assert.equal((await status(tmuxUrl)).pending, 0);
  assert.equal(
    existsSync(join(output, "herdr-input.jsonl")),
    false,
    "画像受信だけではPiの入力送信を起こさないこと",
  );
  await page.screenshot({
    path: join(output, "manual-selection.png"),
    fullPage: true,
  });
  const herdrPending = await readHerdr();
  assert.ok(pendingWidgetLayout(herdrPending).blankRows <= 1, "Herdr内で画像プレビュー用の空白を確保しないこと");
  await writeFile(join(output, "herdr-pending.txt"), herdrPending);
  await writeFile(
    join(output, "browser-accessibility.txt"),
    await page.locator("body").ariaSnapshot(),
  );

  await sendTmux("/photosync receive");
  await page.getByRole("button", { name: "PC側で指定", exact: true }).click();
  await page
    .getByRole("button", { name: "送信するPCを選択", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: new RegExp(`^${outside.host} ·`) })
    .click();
  const targetGroup = (receiver: ReceiverStatus) => page.getByRole("group", {
    name: `送信先: ${receiver.host} / ${receiver.project} [${receiver.shortId}]`, exact: true,
  });
  await targetGroup(outside).waitFor();
  await sendHerdr("/photosync receive");
  await targetGroup(inside).waitFor();
  await sendTmux("/photosync receive");
  await targetGroup(outside).waitFor();
  await upload();
  await waitUntil(
    async () => (await status(tmuxUrl)).pending === 1,
    "PC側で指定した受信先に画像が届くこと",
  );
  assert.equal((await status(herdrUrl)).pending, 1);
  await page.screenshot({
    path: join(output, "pi-selection.png"),
    fullPage: true,
  });
  const tmuxPending = await readTmux();
  const singleImageLayout = pendingWidgetLayout(tmuxPending);
  await writeFile(join(output, "tmux-pending.txt"), tmuxPending);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.screenshot({
    path: join(output, "mobile-list.png"),
    fullPage: true,
  });
  await page.mouse.move(200, 650);
  await page.mouse.wheel(0, 900);
  await upload();
  await waitUntil(
    async () => (await status(tmuxUrl)).pending === 2,
    "スマホ幅の画面からも画像を追加送信できること",
  );
  await page.screenshot({ path: join(output, "mobile.png"), fullPage: true });
  const multipleImages = await readTmux();
  assert.deepEqual(pendingWidgetLayout(multipleImages), singleImageLayout, "画像が増えても未送信表示の高さを増やさないこと");
  await writeFile(join(output, "tmux-multiple-pending.txt"), multipleImages);

  await sendHerdr("この画像を確認してください。");
  await sendTmux("こちらの画像を確認してください。");
  await waitUntil(
    async () =>
      existsSync(join(output, "herdr-input.jsonl")) &&
      existsSync(join(output, "tmux-input.jsonl")),
    "Enterで画像がユーザー入力へ追加されること",
  );
  const expected = (await readFile(image)).toString("base64");
  for (const name of ["herdr", "tmux"]) {
    const input = JSON.parse(
      (await readFile(join(output, `${name}-input.jsonl`), "utf8")).trim(),
    );
    assert.equal(input.images.length, name === "tmux" ? 2 : 1);
    for (const image of input.images) {
      assert.equal(image.data, expected);
      assert.equal(image.mimeType, "image/png");
    }
  }
  assert.equal((await status(tmuxUrl)).pending, 0);
  assert.equal((await status(herdrUrl)).pending, 0);
  assert.deepEqual(errors, []);
  assert.equal(metadataRequests.filter((url) => !url.endsWith("/v1/events")).length, 0, "ブラウザから状態取得のポーリングをしないこと");
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      { outside, inside, webOrigin, errors, metadataRequests, result: "passed" },
      null,
      2,
    ),
  );
  console.log(
    `Web → 対話中のPi（Herdr内外）への送信・手動選択・Pi側指定・Enter時の画像追加を確認: ${output}`,
  );
} catch (error) {
  if (browser) {
    const page = browser.contexts()[0].pages()[0];
    await page.screenshot({
      path: join(output, "failure.png"),
      fullPage: true,
    });
    await writeFile(join(output, "failure.html"), await page.content());
    await writeFile(
      join(output, "failure-accessibility.txt"),
      await page.locator("body").ariaSnapshot(),
    );
  }
  if (tmuxStarted)
    await writeFile(
      join(output, "tmux-failure.txt"),
      (await tmux("capture-pane", "-p", "-S", "-400")).stdout,
    );
  if (paneId)
    await writeFile(
      join(output, "herdr-failure.txt"),
      (
        await herdr(
          "pane",
          "read",
          paneId,
          "--source",
          "recent-unwrapped",
          "--lines",
          "300",
          "--raw",
        )
      ).stdout,
    );
  throw error;
} finally {
  await browser?.close();
  if (tmuxStarted) await tmux("kill-server");
  if (paneId) await herdr("pane", "close", paneId);
  await new Promise<void>((resolve) => web.close(() => resolve()));
}
