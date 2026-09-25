# Agent PhotoSync

Androidで撮影した写真を、同じLAN上のPi Coding AgentやClaude Codeに渡します。
カメラアプリは1つで、PiとClaude Codeのセッションが同じ一覧に並びます。

## 構成

```text
extensions/photosync.ts          Pi拡張の入り口
packages/core/src/               HTTP受信・mDNS探索・受信先指定・未送信画像（共通）
packages/pi/src/                 Pi固有の受信先情報
packages/claude-code/src/        Claude Code用MCPサーバー
apps/camera/                    Flutterアプリ（Android / Web）
test/                           受信・探索・ブラウザと対話中のPiの確認
```

PC側の受信処理は、PiではPi拡張、Claude CodeではMCPサーバーとして動きます。どちらもセッションの開始で待ち受けを開始し、終了すると停止します。
現在のPC側実装はLinux用です。Herdr内外に対応しています。

### 画像の流れ

1. アプリで送信先を選びます。
2. 撮影すると、その画像を選んだPiまたはClaude Codeへ送信します。
3. Piでは画像が添付され、入力欄の上に「未送信」の添付枚数と送信操作の案内が表示されます。文章を入力してEnterを押すと、本文と画像を一緒に送信します。
4. Claude Codeでは「写真を見て」などと頼むと、ClaudeがMCPツール `get_photos` で未取得の画像を受け取ります。1回の応答サイズには上限があり、枚数が多いときは何回かに分けて受け取ります。

どちらも受信しただけではモデルを呼び出しません。

## Pi拡張の起動

確認に使用した環境はNode.js 26.8.2（mise管理）、Pi 0.85.1です。

```bash
npm ci
pi -e ./extensions/photosync.ts
```

すべてのプロジェクトから使う場合は、ローカルパッケージとして登録できます。
次に起動するPiから読み込まれます。

```bash
pi install /絶対パス/photo-sync
```

### Piのコマンド

| コマンド | 内容 |
| --- | --- |
| `/photosync status` | 作業ディレクトリ、PID、端末、セッションID、Herdr上の位置、接続先URL、未送信画像の枚数を表示 |
| `/photosync receive` | このPiを、このPCで「PC側で指定」の受信先にする |
| `/photosync clear` | 未送信の画像の添付を解除する |
| `/photosync web-origin <URL>` | 起動中のPiで、Webアプリの接続元URLを許可する |

`Agent PhotoSync [xxxxxxxx]` の括弧内は、自動で発行する受信先IDの先頭8文字です。同じ作業ディレクトリで複数のPiを開いている場合などに、アプリの一覧とPiの画面を照合できます。
受信先IDはPiの起動、`/reload`、会話の切り替えで変わります。`/photosync status` にはID全体も表示します。

## Claude Codeで使う

Claude CodeにMCPサーバーとして登録します。Node.jsは `mise.toml` で固定した版を `mise exec` で使います（TypeScriptを直接実行するため22.18以降が必要）。

```bash
mise install node
mise exec -- npm ci
claude mcp add --scope user photosync -- \
  mise exec -C /絶対パス/agent-photo-sync -- node packages/claude-code/src/server.ts
```

次に起動するClaude Codeから、セッションごとにMCPサーバーが起動します。写真を送ったら、Claude Codeに「写真を見て」などと頼んでください。

| MCPツール | 内容 |
| --- | --- |
| `get_photos` | 未取得の写真を受信順に返し、返した分を受信箱から消す。1回に返すのはbase64の合計が上限（既定8MB）までで、残りの枚数も返す。保存したファイルのパスも返す |
| `photosync_status` | 受信先ID、未取得の写真の枚数、接続先URLを返す |
| `photosync_receive` | このセッションを「PC側で指定」の受信先にする。「写真の受信先にして」と頼むと呼ばれる |

Web版から送る場合は、登録時に `-e PHOTOSYNC_WEB_ORIGIN=http://127.0.0.1:8080` を付けてWebアプリの接続元URLを許可します。

Claude CodeはMCPの1メッセージが16MBを超えると接続を切ります。`get_photos` の上限は環境変数 `PHOTOSYNC_MAX_RESPONSE_BYTES`（base64の文字数）で変更できますが、16MBより十分小さくしてください。

## 送信先の選び方

### アプリの一覧から選ぶ

AndroidアプリがmDNSでPi拡張とClaude CodeのMCPサーバーを探します。PC名とアドレスの下に、エージェントの種類、作業ディレクトリ、受信先ID、Herdrのワークスペース番号または端末を表示します。
詳細画面でフルパス、セッションID、モデル、PIDも確認できます。

各セッションが固有の受信先IDとポートを持ちます。同じディレクトリや同じ会話を複数開いていても、送信先を区別します。
PCにも識別IDを持たせており、ホスト名が同じPCを区別できます。

### PC側で指定する

アプリで「PC側で指定」を選び、PCを選択します。
そのPCのPiで `/photosync receive` を実行するか、Claude Codeに「写真の受信先にして」と頼むと、そのセッションが送信先になります。
別のセッションで同じ操作をすれば、以降はそちらが送信先になります。PiとClaude Codeの間でも切り替わります。
受信先の情報と未送信画像の枚数はSSEで通知します。PC側の指定、画像の受信・解除、セッションの追加・終了を変更時に反映し、定期ポーリングは行いません。
接続失敗や切断時はエラーを表示し、「接続」または「送信先を更新」を押したときに再接続します。

この指定は同じPC・ユーザーの `$XDG_STATE_HOME/agent-photosync`（未設定時は `~/.local/state/agent-photosync`）で共有します。指定されたセッションが終了しても、他のセッションを自動で選びません。

### Herdr内外の違い

受信と添付の動作は同じです。Herdr内ではワークスペース番号・名前とペインID・タブIDを追加で取得します。
Herdr外ではLinuxの端末名（`/dev/pts/1` など）を表示します。

## Flutterアプリ

確認に使用した環境はFlutter 3.47.2 / Dart 3.13.2です。
アプリの処理はDartで実装しています。カメラと探索は既存のFlutterプラグインを通して使います。
Android側にはFlutterが生成したJavaの起動コードとGradle設定があり、独自のKotlinコードはありません。

Flutterは [mise](https://mise.jdx.dev/) で管理し、`mise.toml` で3.47.2に固定しています。
プロジェクトのルートで準備します。

```bash
mise trust
mise install
mise run camera:deps
```

以降の `mise run` はプロジェクトのルートから実行できます。Flutter用のPATH設定や `cd apps/camera` は不要です。
Flutterコマンドを直接使う場合は、`apps/camera` 内で `mise exec -- flutter <コマンド>` と実行してください。

### Webで送信を確認する

ブラウザはLANのmDNSを直接探索できないため、Web版には受信先の接続先URLを入力する欄があります。
接続後はその受信先が発見した他の受信先も一覧に表示します。

プロジェクトのルートでWeb版を起動します。

```bash
mise run web
```

`http://127.0.0.1:8080` で開けます。終了は起動したターミナルで `q` を押します。

Webアプリの接続元URLを、受信先ごとに許可します。Claude Codeでは、MCPサーバーの登録時に `-e PHOTOSYNC_WEB_ORIGIN=http://127.0.0.1:8080` を付けます（「Claude Codeで使う」を参照）。
Piでは、拡張を読み込んだPiの入力欄で許可します。アプリ画面にも、そのブラウザで必要なコマンドを表示します。複数のPiで確認する場合は、それぞれで設定してください。

```text
/photosync web-origin http://127.0.0.1:8080
/photosync status
```

コマンドで指定したWeb接続の許可は、再読み込みやセッション終了時にクリアされます。起動時に指定する場合は、次のオプションを使います。

```bash
pi -e /絶対パス/agent-photo-sync/extensions/photosync.ts \
  --photosync-web-origin http://127.0.0.1:8080
```

1. Piで `/photosync status` を実行します。Claude Codeでは「PhotoSyncの状態を見せて」と頼みます（`photosync_status`）。
2. ブラウザで `http://127.0.0.1:8080` を開きます。
3. 「このPCのWeb確認用」に表示されたURLを入力して「接続」を押します。
4. 送信先を選択し、「画像ファイルを選んで送信」を押します。
5. `test/fixtures/photo.png` などのPNG/JPEGを選びます。
6. Piでは画像が添付され、「未送信」の枚数が増えることを確認します。Claude Codeでは「写真を見て」と頼み、画像が読み込まれることを確認します。

PCのカメラは不要です。Webでカメラを使う場合、ブラウザのカメラAPIにはlocalhostまたはHTTPSが必要です。

`ClientException: Failed to fetch` が表示された場合は、接続先URLと、Piでは `/photosync status` の「Web接続の許可」、Claude Codeでは `PHOTOSYNC_WEB_ORIGIN` の値を確認してください。
許可するのは受信ポートのURLではなく、ブラウザで開いているWebアプリのURLです。`localhost` と `127.0.0.1` は別の接続元として扱われます。

コード更新後はPiで `/reload`、Flutterの起動ターミナルで `R`（Hot restart）を実行してください。
Piの再読み込みでWeb接続の許可がクリアされ、受信ポートも変わる場合があるため、許可を設定し直し、`/photosync status` の接続先URLで再接続します。

### Androidで動かす

対応範囲はAndroid 7.0（API 24）以降です。APKを作ってスマホへ渡せば、USBデバッグなしでインストールできます。

Android SDKのコマンドラインツールと、ビルド用のJDK 21もmiseで管理します。
プロジェクトのルートで、次の準備を行います。

```bash
mise install
mise run android:setup
```

`android:setup` はAndroid CLIを使い、mise管理のSDKへPlatform Tools、Android API 36、Build Tools 36.0.0、NDK 28.2.13676358を導入します。
利用条件は [Android SDKのライセンス](https://developer.android.com/studio/terms) を確認してください。

準備後にAPKをビルドします。

```bash
mise run android:build
```

出力先は `apps/camera/build/app/outputs/flutter-apk/app-debug.apk`（約150MiB）です。
USBでのコピーやファイル共有アプリでスマホへ渡すほか、スマホにアプリを追加せずに、LANで一時的に配信してQRコードから取得することもできます。
配信に使うポートは、PCのファイアウォールで許可されている必要があります。次の例は、受信用に許可する47800〜47819番の最後の番号を使います。

```bash
mkdir -p /tmp/apk-share
cp apps/camera/build/app/outputs/flutter-apk/app-debug.apk /tmp/apk-share/agent-photosync.apk
qrencode -t ansiutf8 "http://<PCのLAN IP>:47819/agent-photosync.apk"
python3 -m http.server 47819 --bind 0.0.0.0 --directory /tmp/apk-share
```

配信中は同じLANの誰でもAPKを取得できます。インストールが終わったら `Ctrl+C` で止めてください。

スマホで取得したAPKを開き、必要な場合は、そのファイルを開くアプリ（ブラウザなど）の「不明なアプリのインストール」を許可します。
旧名の **Pi PhotoSync**（`dev.photosync.pi_photosync`）が入っている場合は、別のアプリとして残るため削除してください。
インストール後に **Agent PhotoSync** を開き、カメラの使用を許可してください。

USBで開発・実行する場合は、スマホの開発者向けオプションでUSBデバッグを有効にし、接続時にPCを許可した後、次を実行します。

```bash
cd apps/camera
mise exec -- flutter devices
mise exec -- flutter run -d <AndroidのデバイスID>
```

Androidアプリを開くとLANのPiとClaude Codeを探索します。Web版のCORS設定は不要です。
スマホとPCを同じWi-Fiへ接続し、PC側のファイアウォールで通信を許可してください。
送信先と使用するカメラを選び、「撮影して送信」を押します。

Androidでは `takePicture()` の一時ファイル保存を使わず、画像ストリームの1フレームをDartでJPEGに変換します。
通常の静止画撮影とは、解像度や画質、端末の補正処理が異なる可能性があります。実機での確認項目です。
Webのカメラ撮影ではブラウザ内のBlobを読み取ります。

### データの保持

- Androidで撮影した画像はメモリ上で扱い、写真フォルダやキャッシュファイルへ保存しません。
- PC側の未送信画像もメモリ上にあります。Piの終了、`/reload`、会話の切り替え、Claude Codeの終了で失われます。
- Claude Codeでは、受信した画像を `~/.local/state/agent-photosync/photos/<起動日時>-<受信先IDの先頭8文字>/` にもファイルとして保存します。MCPサーバーの再起動で未取得の画像が受信箱から消えても、このファイルは残ります。自動では削除しません。
- Piではメッセージ送信後、Claude Codeでは `get_photos` の実行後に、画像が会話履歴に含まれます。クラウドモデルを使う場合はモデル提供元へ送られます。
- PCに共有する受信先指定ファイルにはIDだけを保存します。場所は `~/.local/state/agent-photosync/selected-receiver` です。

## ネットワークと利用範囲

この初期実装は、信頼できるLANでの利用を想定しています。HTTP通信で、認証・暗号化・アップロードサイズ制限は実装していません。
同じLANの端末は受信先情報を取得し、画像を送信できます。インターネットへポートを公開しないでください。
Web用オリジンの指定はブラウザのCORS設定であり、認証の代わりにはなりません。
画像の送信はHTTP POST、状態の通知はHTTPのSSE接続を使用します。

- IPv4とmDNS（UDP 5353）を使用します。
- 画像受信のTCPポートは、47800〜47819番のうち空いている番号を使います。セッションごとに1つ使うため、同時に20セッションまで受信できます。
  環境変数 `PHOTOSYNC_PORT_RANGE`（例: `48000-48009`）で範囲を変更できます。
- PCのファイアウォールで、mDNS（UDP 5353）と受信ポートの範囲への通信が必要です。
  Fedora Workstationの既定のゾーンは1025〜65535番を許可しているため、追加の設定は不要です。
  受信を既定で拒否するufwなどでは、LANからのこれらのポートを許可します。ufwの例（LANが192.168.0.0/24の場合）:

  ```bash
  sudo ufw allow from 192.168.0.0/24 to any port 5353 proto udp comment 'Agent PhotoSync mDNS'
  sudo ufw allow from 192.168.0.0/24 to any port 47800:47819 proto tcp comment 'Agent PhotoSync'
  ```

  許可する送信元をスマホのIPアドレス（ルーターのDHCP予約で固定）にすると、さらに範囲を絞れます。
- ゲストWi-Fiや端末間通信を遮断するネットワークでは通信できません。

## 検査・テスト

```bash
npm run check
npm test
npm run test:discovery

mise run camera:check
mise run web:build
```

対話中のPiとブラウザを使った確認は、Herdr内のシェルで実行します。
Chrome、tmux 3.5以降、Herdr、ビルド済みのWebアプリが必要です。

```bash
PHOTOSYNC_CHROME="$(command -v google-chrome)" npm run test:e2e
```

このテストは専用のtmuxサーバーとHerdrの隣接ペインにPiを起動します。
両方の送信先選択、画像受信、Enter時の画像追加を確認し、自分で作ったペインとプロセスを終了します。
テスト用Piの入力イベントで送信内容を記録するため、モデルへの問い合わせは行いません。
結果と画面画像は `.artifacts/e2e-*/` に保存します。

今回確認した範囲と実機で残る項目は [docs/verification.md](docs/verification.md)、通信形式は [docs/protocol.md](docs/protocol.md) を参照してください。
