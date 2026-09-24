# Pi PhotoSyncの通信

## 探索

Pi拡張は `_pi-photosync._tcp` をmDNSで公開します。
サービス名は `Pi PhotoSync <受信先ID>`、TXTレコードの `id` は受信先のUUIDです。
SRVレコードのポートへHTTPで接続します。

Androidは `nsd` プラグインでIPv4の接続先を取得します。
Webでは入力されたPiの `/v1/events` を開き、初回の通知から他のPiの接続先も取得します。
Pi拡張同士の探索にも同じmDNSを使います。

## エンドポイント

### GET /v1/events

`Content-Type: text/event-stream` のSSE接続です。接続を開いたまま、状態が変わったときに通知します。
画像のバイナリはこの接続に含めません。

| イベント | data |
| --- | --- |
| `snapshot` | `{ "receiver": <受信先の状態>, "peers": [<接続先>] }`。接続直後に送る |
| `status` | `/v1/status` と同じ形式。添付枚数、指定先、モデル、セッション名の変更 |
| `peer-up` | `{ "id": "受信先UUID", "url": "http://..." }`。mDNSで受信先を発見 |
| `peer-down` | `{ "id": "受信先UUID" }`。mDNSで受信先の終了を検出 |

各Piに対してSSE接続を開きます。同じ受信先IDを異なるアドレスから発見しても、接続を重複させません。
同じ状態の通知はPi側で抑制します。アプリは定期取得や自動再接続を行わず、再接続は明示的な操作で行います。

### GET /v1/status

```json
{
  "id": "受信先UUID",
  "shortId": "UUIDの先頭8文字",
  "hostId": "PCとPi設定ディレクトリを識別する値",
  "host": "fedora",
  "cwd": "/home/user/dev/photo-sync",
  "project": "photo-sync",
  "pid": 1234,
  "terminal": "/dev/pts/1",
  "sessionId": "PiのセッションUUID",
  "sessionName": null,
  "model": null,
  "herdr": {
    "workspaceId": "w1",
    "workspaceNumber": 1,
    "workspaceName": "photo-sync",
    "paneId": "w1:p1",
    "tabId": "w1:t1"
  },
  "preferred": false,
  "selection": { "receiverId": "", "revision": "1234567890" },
  "pending": 0
}
```

`herdr` はHerdr外では `null` です。
`hostId` はLinuxのmachine-idとPi設定ディレクトリからSHA-256で算出します。machine-id自体は公開しません。
アプリのPC選択には `hostId` を使い、表示にはホスト名とアドレスを使います。

`id` はPi拡張のセッション開始時に新しく発行します。Piの会話の `sessionId` と区別します。

### GET /v1/peers

自分と、mDNSで発見したPi拡張の接続先を返します。

```json
[
  { "id": "受信先UUID", "url": "http://192.168.0.10:12345" }
]
```

このエンドポイントと `/v1/status` は調査用にも利用できます。アプリの通常の更新にはSSEを使用します。

### POST /v1/photos/<受信先UUID>

リクエスト本文は画像のバイナリです。`Content-Type` に `image/jpeg` または `image/png` を指定します。
画像ファイル名は送信しません。

成功時はHTTP 200と以下のJSONを返します。

```json
{ "id": "受信先UUID", "pending": 1 }
```

そのプロセスの受信先IDに一致しないURLはHTTP 404になります。
画像は受信したPiのメモリに入り、次の対話入力の `images` に追加されます。

### OPTIONS

Webからの送信に必要なCORSプリフライトにHTTP 204で応答します。
許可するWebオリジンは `--photosync-web-origin`、または起動中の `/photosync web-origin <URL>` で指定します。

## Pi側から受信先を指定する

`/photosync receive` は共有ファイルの受信先IDを更新します。
各Piがファイルの変更を監視し、SSEの `status` イベントを送ります。
`selection.receiverId` は指定されたID、`selection.revision` は同じファイルから読み取った更新時刻（ナノ秒の文字列）です。
`preferred` は自身のIDと指定先IDが一致するかを表します。

アプリが「Pi側で指定」を使う場合は、選んだ `hostId` の最新の `selection.receiverId` を使います。
別々のPiからの通知が前後する場合は、`revision` で新旧を比較します。
「一覧から選ぶ」を使う場合は、ユーザーが選んだ受信先IDに送ります。

通信、JSON解析、画像の取得などの失敗は表示し、自動的な再送や他の受信先への切り替えは行いません。
