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

  /**
   * 受信順に画像を取り出す。maxBytesを指定すると、base64の合計がその値を
   * 超えない枚数だけ返し、残りは受信箱に残す。1枚目が上限を超える場合もその1枚は返す。
   */
  take(maxBytes = Infinity): ImageContent[] {
    let count = 0;
    let total = 0;
    for (const image of this.images) {
      total += image.data.length;
      if (count > 0 && total > maxBytes) break;
      count++;
    }
    return this.images.splice(0, count);
  }
}
