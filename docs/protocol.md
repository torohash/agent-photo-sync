# Agent PhotoSyncの通信

## 探索

Pi拡張とClaude Code用MCPサーバー（以下、受信先）は `_agent-photosync._tcp` をmDNSで公開します。
サービス名は `Agent PhotoSync <受信先ID>`、TXTレコードの `id` は受信先のUUIDです。
SRVレコードのポートへHTTPで接続します。

Androidは `nsd` プラグインでIPv4の接続先を取得します。
Webでは入力された受信先の `/v1/events` を開き、初回の通知から他の受信先の接続先も取得します。
受信先同士の探索にも同じmDNSを使います。

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

各受信先に対してSSE接続を開きます。同じ受信先IDを異なるアドレスから発見しても、接続を重複させません。
同じ状態の通知は受信先側で抑制します。アプリは定期取得や自動再接続を行わず、再接続は明示的な操作で行います。

### GET /v1/status

```json
{
  "agent": "pi",
  "id": "受信先UUID",
  "shortId": "UUIDの先頭8文字",
  "hostId": "PCと共有ディレクトリを識別する値",
  "host": "fedora",
  "cwd": "/home/user/dev/photo-sync",
  "project": "photo-sync",
  "pid": 1234,
  "terminal": "/dev/pts/1",
  "sessionId": "エージェントのセッションID",
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

`agent` は `pi` または `claude-code` です。アプリは受信後の案内文をこの値で切り替えます。
`herdr` はHerdr外では `null` です。
`hostId` はLinuxのmachine-idと、受信先指定の共有ディレクトリ（`$XDG_STATE_HOME/agent-photosync`、未設定時は `~/.local/state/agent-photosync`）からSHA-256で算出します。同じPCのPiとClaude Codeは同じ値になります。machine-id自体は公開しません。
アプリのPC選択には `hostId` を使い、表示にはホスト名とアドレスを使います。

`id` は受信先の起動時に新しく発行します。会話の `sessionId` と区別します。

Claude Codeの場合、`pid` と `terminal` はMCPサーバーではなくClaude Code本体（環境変数 `CLAUDE_PID`）のものです。
`sessionId` は環境変数 `CLAUDE_CODE_SESSION_ID` から取得し、`sessionName` と `model` は `null` です。

### GET /v1/peers

自分と、mDNSで発見した受信先の接続先を返します。

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
画像は受信先のメモリに入ります。Piでは次の対話入力の `images` に追加され、Claude CodeではMCPツール `get_photos` の結果として返します。Claude Codeでは、受信時に画像をファイルにも保存します。`get_photos` は応答サイズの上限まで受信順に返し、残りは次の呼び出しで返します。

### OPTIONS

Webからの送信に必要なCORSプリフライトにHTTP 204で応答します。
許可するWebオリジンは、Piでは `--photosync-web-origin` または起動中の `/photosync web-origin <URL>`、Claude CodeではMCPサーバーの環境変数 `PHOTOSYNC_WEB_ORIGIN` で指定します。

## PC側で受信先を指定する

Piの `/photosync receive` とClaude CodeのMCPツール `photosync_receive` は、共有ファイルの受信先IDを更新します。
各受信先がファイルの変更を監視し、SSEの `status` イベントを送ります。
`selection.receiverId` は指定されたID、`selection.revision` は同じファイルから読み取った更新時刻（ナノ秒の文字列）です。
`preferred` は自身のIDと指定先IDが一致するかを表します。

アプリが「PC側で指定」を使う場合は、選んだ `hostId` の最新の `selection.receiverId` を使います。
別々の受信先からの通知が前後する場合は、`revision` で新旧を比較します。
「一覧から選ぶ」を使う場合は、ユーザーが選んだ受信先IDに送ります。

通信、JSON解析、画像の取得などの失敗は表示し、自動的な再送や他の受信先への切り替えは行いません。
