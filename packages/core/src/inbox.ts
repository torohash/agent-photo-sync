import { Buffer } from "node:buffer";
/** PiのImageContentとMCPの画像コンテンツに共通する形。 */
export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

/** 受信画像をエージェントへ渡すまでメモリに保持する。 */
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
