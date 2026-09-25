# Agent PhotoSync カメラアプリ

Android向けのFlutterアプリです。Web版はPCで画像送信を確認するために使います。
送信先はPi拡張とClaude Code用MCPサーバーで、どちらも同じ通信形式（[docs/protocol.md](../../docs/protocol.md)）で受信します。

起動、受信先との接続、テストの手順は [プロジェクトのREADME](../../README.md) を参照してください。

- `photosync_page.dart`: 接続と送信画面
- `receiver.dart`: 受信先の状態と、Pi・Claude Codeごとの表示
- `receiver_list.dart`: 送信先の一覧
- `receiver_controller.dart`: SSE接続、送信先一覧と選択状態
- `receiver_event.dart`: SSE通知の読み取り
- `photosync_client.dart`: 受信先への画像送信とSSE通信
- `memory_camera.dart`: ファイルを保存しない撮影
- `frame_encoder.dart`: AndroidのカメラフレームをJPEGへ変換
