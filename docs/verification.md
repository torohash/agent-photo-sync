# 動作確認

2026-09-07に、このPCで実施した確認です。

## 環境

- PC: Fedora Linux 44 / GNOME Wayland
- Node.js: 24.13.0
- Pi Coding Agent: 0.85.1
- Flutter: 3.47.2 / Dart: 3.13.2
- Android SDKコマンドラインツール: 23.0（mise管理）
- Androidビルド用JDK: Temurin 21.0.12.1（mise管理）
- ブラウザ: Google Chrome 145、独立したテスト用プロファイル
- 対話端末: Herdrの新しい隣接ペイン、専用のtmuxサーバー

Android SDKを導入し、APKのビルドと署名を確認しました。Android実機は接続されておらず、インストール・実機撮影は未確認です。

## 完了した確認

### Pi側

- `npm run check`: TypeScriptの型検査を通過。
- `npm test`: 実際のHTTPサーバーを2つ起動して検証。
  - 同じディレクトリでも受信先IDにより送り分けられる。
  - 受信した画像のバイト列が元画像と一致する。
  - 受信先IDが違うURLへ送った画像を、他の受信先へ入れない。
  - Pi側の受信先指定が切り替わる。
  - 添付待ちを取り出すと、その画像が次回へ重複して残らない。
  - 指定したWebオリジンでCORSプリフライトに応答する。
- `npm run test:discovery`: 別々のNodeプロセスからmDNSサービスを公開。
  - 一方が他方を発見。
  - 発見結果の `192.168.0.169:<port>` からHTTPで接続し、相手のIDを確認。

### Flutter側

- `flutter analyze`: 指摘なし。
- `flutter test`: 3件通過。
  - 同じプロジェクトの受信先をHerdrのワークスペース番号とIDで選び分ける。
  - 同名のPCを区別し、スマホの明示選択とPi側の指定を別々に扱う。実行中の状態更新がある場合は、その完了を待つ。
  - YUV420の行の余白・画素間隔を考慮してJPEGへ変換し、90度回転した寸法と色を確認。
- `flutter build web --release --no-web-resources-cdn`: 通過。

### Webと対話中のPiをつないだ確認

`npm run test:e2e` で、同じ作業ディレクトリにPiを2つ起動しました。
一方をHerdr内、もう一方をHerdr外のtmuxで動かしています。

1. `/photosync status` が接続先、作業ディレクトリ、端末、Herdr上の実際の位置を表示する。
2. 拡張同士をmDNSで発見し、Flutter Webの一覧に両方が表示される。
3. WebでHerdr側を選び、ファイル選択画面からPNGを送る。
4. Herdr側だけが添付待ち1枚になり、入力メッセージはまだ発生しない。
5. tmux側で `/photosync receive` を実行する。
6. Webを「Pi側で指定」へ切り替え、同じPCを選んで送る。
7. tmux側だけに画像が届く。
8. ブラウザを390px幅に変更し、スクロールして送信操作を行う。tmux側にもう1枚届く。
9. 各Piで文章を入力してEnterを押す。
10. 実際のPi入力イベントで、Herdr側は画像1枚、tmux側は画像2枚を受け取る。全画像のバイト列とMIME型が一致する。
11. 添付待ちが0枚になり、ブラウザの実行時エラーがない。

モデルを呼び出す手前の入力イベントで、テスト用拡張が内容を記録しています。モデルからの画像認識結果を確認したテストではありません。
テスト用のPi、tmuxサーバー、Herdrのペインは終了し、元のHerdrの配置へ戻しています。

今回の最終実行の記録:

```text
.artifacts/e2e-1788753619548/
  result.json
  manual-selection.png
  pi-selection.png
  mobile-list.png
  mobile.png
  herdr-pending.txt
  tmux-pending.txt
  herdr-input.jsonl
  tmux-input.jsonl
```

`.artifacts/` はGit管理外です。再実行すると、新しい日時のディレクトリに記録します。

## miseへの移行後の確認

`mise.toml` でFlutter 3.47.2を固定し、既存のmise管理SDKを使用するようにしました。

- `mise run camera:deps`: SDKへの参照を更新。
- `mise run camera:check`: 静的検査と3件のテストを通過。
- `mise run web:build`: Webビルドを通過。
- `mise run web`: 対話端末で起動し、HTTP 200とChrome上でのアプリ起動を確認。`q` で終了。
- 重複して配置した `~/.cache/pi-photosync/flutter`（約1.6GB）を削除。削除後もmiseのFlutterが起動することを確認。

## SSEへの変更後の確認

状態の定期取得をSSEへ変更し、以下を確認しました。

- Nodeの型検査と2件のテストを通過。実際のSSE接続で、添付枚数、別のPiによる受信先指定、Piの発見・終了の通知を確認。
- Flutterの静的検査と5件のテストを通過。通知順が逆転した場合の指定先、接続失敗後の明示的な再接続、UTF-8の文字境界で分割されたSSEデータの復元も確認。
- Webビルドを通過。
- ブラウザでWeb接続を許可していないPiに接続し、CORSによる失敗を再現。4秒待っても再試行が発生しないことを確認。
- Piを再起動せず `/photosync web-origin <URL>` で許可し、再び「接続」を押すと受信先が表示されることを確認。
- 「送信先を更新」を押さずに、別のPiで `/photosync receive` を実行した結果が反映されることを確認。
- Webから画像を送って添付し、Enter時に元画像のバイト列がそのままPiの入力イベントへ渡ることを確認。
- ブラウザの通信記録に `/v1/status` や `/v1/peers` の定期取得がなく、状態の受信は `/v1/events` のみであることを確認。

記録は `.artifacts/e2e-1788760700221/` にあります。`result.json` の `metadataRequests` に状態通知の接続先を記録しています。
この確認では、CORS未許可の接続失敗が意図的にブラウザのコンソールへ出ます。

## 未送信表示の余白の確認

画像ごとのプレビュー領域を削除し、未送信表示を枚数と送信操作の案内にしました。

- Herdr内で、画像プレビュー用の空白行が残らないことを確認。
- tmux内で、画像を1枚から2枚に増やしても未送信表示の行数・空白行数が変わらないことを確認。
- 複数の画像データは保持され、Enter時に元のバイト列がPiへ渡ることを確認。

記録は `.artifacts/e2e-1788767271643/` にあります。複数枚のときの表示は `tmux-multiple-pending.txt` に記録しています。

## Android APKのビルド

- `mise run android:setup` で、mise管理のSDKへAPI 36、Build Tools 36.0.0、Platform Tools、NDK 28.2.13676358を導入。
- このPCの既存Javaにはコンパイラがなかったため、mise管理のJDK 21を導入。
- `mise run android:build` が成功し、`apps/camera/build/app/outputs/flutter-apk/app-debug.apk` を生成。
- `apksigner verify` でAPK Signature Scheme v2の署名を確認。
- `aapt dump badging` で表示名 `Pi PhotoSync`、アプリID `dev.photosync.pi_photosync`、バージョン0.1.0、最低API 24、対象API 36を確認。
- ARM64・ARMv7・x86_64を含む開発用APK。サイズは約150MiB。
- マイクと外部ストレージの権限がAPKに含まれないことを確認。
- ビルド時に `nsd_android` のKGP移行とSDK XMLのバージョンに関する警告が出ますが、現在の固定バージョンではビルドを通過しています。

記録は `.artifacts/android-build.log`、`.artifacts/android-apk-badging.txt` にあります。

## Android実機・別PCで残る確認

- Android APKのインストールと起動。
- Androidのカメラ権限、プレビュー、撮影、回転、色味、解像度。
- 撮影中の画面切り替えや、アプリが背面に回ったときのカメラの動作。
- AndroidのNSDプラグインを通した、実際のWi-Fi上のPi探索。
- 物理的に別のPCへのmDNS探索と画像転送。
- 端末・PCのファイアウォールやWi-Fiの端末間通信設定を含む接続。

別プロセスとLANアドレスを使った今回の確認は、物理的に別のPCとの通信を保証するものではありません。
このPCのfirewalldは稼働中です。現在のWi-FiにはFedoraWorkstationゾーンが適用され、TCP・UDPの1025〜65535番が許可されています。mDNSとPiの受信ポートはこの範囲に含まれます。別の環境ではUDP 5353とPiが表示するTCPポートへの通信許可を確認してください。

## 使用する範囲

初期実装は信頼できるLAN用です。接続相手の認証、暗号化、アップロードサイズ制限は今後の検討項目です。
Androidの撮影はファイル保存を避けるため画像ストリームを使っています。通常の静止画撮影の画質や端末固有の補正機能との違いは、実機で評価する必要があります。

## Claude Code対応とAgent PhotoSyncへの改名後の確認

2026-09-25に、このPCで実施した確認です。Node.js 26.8.2、Flutter 3.47.2（いずれもmise管理）。

- `npm run check`: 型検査を通過。
- `npm test`: 3件通過。既存の2件に加え、Claude Code用MCPサーバーをNode.jsでTypeScriptのまま起動し、MCPクライアントから以下を確認。
  - `/v1/status` の `agent` が `claude-code`、`sessionId` が `CLAUDE_CODE_SESSION_ID` の値になる。
  - POSTした画像を `get_photos` が元のバイト列・MIME型のまま返し、2回目は空になる。
  - `photosync_receive` で共有の受信先指定ファイルが更新される。
- `npm run test:discovery`: 新しいサービス種別 `_agent-photosync._tcp` で別プロセスを発見し、LANアドレスから接続。
- README記載の `mise exec -C <リポジトリ> -- node packages/claude-code/src/server.ts` をstdioで起動し、3つのツールが一覧に出ることを確認。
- `mise run camera:check`: 静的検査は指摘なし、5件のテストを通過（一覧にPiとClaude Codeの種類が表示されることを追加）。
- `mise run web:build`: 通過。

未確認の項目:

- 実際のClaude Codeに登録した状態での、写真の受信と `get_photos` による画像の読み込み。
- `npm run test:e2e`（文言を更新済み。Chrome・tmux・Herdrを使うため未実行）。
- 改名後のAPKのビルドとAndroid実機。applicationIdが変わるため、旧 **Pi PhotoSync** とは別のアプリとしてインストールされます。
