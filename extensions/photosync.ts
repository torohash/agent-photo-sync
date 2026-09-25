import { randomUUID } from "node:crypto";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { PhotoDiscovery } from "../packages/core/src/discovery.ts";
import {
  lanUrls,
  receiverPorts,
  stateDirectory,
} from "../packages/core/src/host.ts";
import { PhotoInbox } from "../packages/core/src/inbox.ts";
import { PhotoReceiver } from "../packages/core/src/receiver.ts";
import { ReceiverSelection } from "../packages/core/src/selection.ts";
import { readIdentity } from "../packages/pi/src/identity.ts";

export default function photosync(pi: ExtensionAPI): void {
  pi.registerFlag("photosync-web-origin", {
    description:
      "Web確認用のFlutterアプリのオリジン（例: http://127.0.0.1:8080）",
    type: "string",
  });
  let receiver: PhotoReceiver | undefined;
  let discovery: PhotoDiscovery | undefined;
  let inbox = new PhotoInbox();
  let receiverId = "";
  const selection = new ReceiverSelection(stateDirectory());

  function displayInbox(ctx: ExtensionContext): void {
    ctx.ui.setStatus(
      "photosync",
      `Agent PhotoSync [${receiverId.slice(0, 8)}] · 未送信 ${inbox.pending.length}枚`,
    );
    if (inbox.pending.length === 0) {
      ctx.ui.setWidget("photosync", undefined);
      return;
    }
    ctx.ui.setWidget("photosync", (_tui, theme) =>
      new Text(
        theme.fg(
          "accent",
          `Agent PhotoSync · 添付画像 ${inbox.pending.length}枚（未送信） · 文章を入力してEnterで送信`,
        ),
        0,
        0,
      ),
    );
  }

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    inbox = new PhotoInbox();
    receiverId = randomUUID();
    discovery = new PhotoDiscovery(
      (error) => ctx.ui.notify(String(error), "error"),
      (change) => receiver?.notifyPeer(change),
    );
    receiver = new PhotoReceiver({
      id: receiverId,
      host: "0.0.0.0",
      ports: receiverPorts(),
      webOrigin: pi.getFlag("photosync-web-origin") as string | undefined,
      inbox,
      selection,
      identity: () => readIdentity(ctx),
      peers: () => discovery!.peers(),
      onPhoto: () => displayInbox(ctx),
      onError: (error) => ctx.ui.notify(String(error), "error"),
    });
    await receiver.start();
    discovery.start(receiverId, receiver.port);
    displayInbox(ctx);
  });

  pi.on("input", (event, ctx) => {
    if (event.source !== "interactive" || inbox.pending.length === 0) return;
    const images = [...(event.images ?? []), ...inbox.take()];
    displayInbox(ctx);
    receiver?.notifyStatus();
    return { action: "transform", text: event.text, images };
  });

  pi.on("model_select", () => receiver?.notifyStatus());
  pi.on("session_info_changed", () => receiver?.notifyStatus());

  pi.registerCommand("photosync", {
    description:
      "Agent PhotoSync — スマホカメラとの接続状態・受信先指定・添付の解除",
    getArgumentCompletions: (prefix) =>
      ["status", "receive", "clear", "web-origin"]
        .filter((value) => value.startsWith(prefix))
        .map((value) => ({ value, label: value })),
    handler: async (args, ctx) => {
      if (args === "receive") {
        await selection.select(receiverId);
        ctx.ui.notify(
          `Agent PhotoSync [${receiverId.slice(0, 8)}] をこのPCの受信先に指定しました。`,
          "info",
        );
      } else if (args === "clear") {
        inbox.take();
        displayInbox(ctx);
        receiver?.notifyStatus();
      } else if (args.startsWith("web-origin ")) {
        receiver!.webOrigin = args.slice("web-origin ".length);
        ctx.ui.notify(`Web接続を許可: ${receiver!.webOrigin}。アプリの「接続」を押してください。`, "info");
      } else if (args === "status") {
        const status = await receiver!.status();
        ctx.ui.notify(
          [
            `Agent PhotoSync [${status.shortId}]`,
            `受信先ID: ${status.id}`,
            `PC: ${status.host}`,
            `作業ディレクトリ: ${status.cwd}`,
            `PID: ${status.pid} / 端末: ${status.terminal}`,
            `セッションID: ${status.sessionId}`,
            ...(status.herdr
              ? [
                  `Herdr: ワークスペース${status.herdr.workspaceNumber} / ${status.herdr.paneId}`,
                ]
              : []),
            `PC側で指定: ${status.preferred ? "選択中" : "未選択"} / 未送信の添付画像: ${status.pending}枚`,
            `Web接続の許可: ${receiver!.webOrigin ?? "未設定（/photosync web-origin <URL> で設定）"}`,
            `このPCのWeb確認用: http://127.0.0.1:${receiver!.port}`,
            ...lanUrls(receiver!.port).map((address) => `LAN接続先: ${address}`),
          ].join("\n"),
          "info",
        );
      } else {
        ctx.ui.notify("/photosync status | receive | clear | web-origin <URL>", "info");
      }
    },
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (!receiver) return;
    await receiver.close();
    await discovery!.close();
    receiver = undefined;
    discovery = undefined;
    inbox.take();
    ctx.ui.setWidget("photosync", undefined);
    ctx.ui.setStatus("photosync", undefined);
  });
}
