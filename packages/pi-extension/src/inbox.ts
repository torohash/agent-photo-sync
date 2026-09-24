import { Buffer } from "node:buffer";
import type { ImageContent } from "@earendil-works/pi-ai";

/** 受信画像を次のユーザーメッセージまでメモリに保持する。 */
export class PhotoInbox {
  private images: ImageContent[] = [];

  get pending(): readonly ImageContent[] {
    return this.images;
  }

  add(bytes: Uint8Array, mimeType: string): void {
    this.images.push({
      type: "image",
      data: Buffer.from(bytes).toString("base64"),
      mimeType,
    });
  }

  take(): ImageContent[] {
    const images = this.images;
    this.images = [];
    return images;
  }
}
