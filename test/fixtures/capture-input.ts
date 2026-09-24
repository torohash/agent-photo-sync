import { appendFile } from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** 実際のPi入力イベントで添付内容を記録し、テスト中のモデル呼び出しを止める。 */
export default function captureInput(pi: ExtensionAPI): void {
  pi.on("input", async (event, ctx) => {
    if (event.source !== "interactive") return;
    await appendFile(
      process.env.PHOTOSYNC_CAPTURE_FILE!,
      `${JSON.stringify({ text: event.text, images: event.images })}\n`,
    );
    ctx.ui.notify(
      `テスト入力を受け取りました（画像${event.images?.length ?? 0}枚）。`,
      "info",
    );
    return { action: "handled" };
  });
}
