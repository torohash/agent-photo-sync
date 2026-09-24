import { watch, type FSWatcher } from "node:fs";
import { mkdir, open, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SelectionSnapshot } from "./protocol.ts";

/** 同じPC・ユーザーのPi拡張が、コマンドで指定された受信先を共有する。 */
export class ReceiverSelection {
  private readonly path: string;

  constructor(private readonly directory: string) {
    this.path = join(directory, "selected-receiver");
  }

  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const file = await open(this.path, "a");
    await file.close();
  }

  async get(): Promise<string> {
    return (await this.snapshot()).receiverId;
  }

  async snapshot(): Promise<SelectionSnapshot> {
    const file = await open(this.path, "r");
    try {
      // renameで置き換えられる前の内容と更新時刻も、同じファイルから読む。
      const receiverId = await file.readFile("utf8");
      const stat = await file.stat({ bigint: true });
      return { receiverId, revision: stat.mtimeNs.toString() };
    } finally {
      await file.close();
    }
  }

  watch(onChange: () => void): FSWatcher {
    return watch(this.directory, (_event, name) => {
      if (name === "selected-receiver") onChange();
    });
  }

  async select(id: string): Promise<void> {
    const temporary = join(this.directory, `selection-${id}`);
    await writeFile(temporary, id);
    await rename(temporary, this.path);
  }
}
