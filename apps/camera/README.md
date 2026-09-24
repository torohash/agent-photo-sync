# Pi PhotoSync カメラアプリ

Android向けのFlutterアプリです。Web版はPCで画像送信を確認するために使います。

起動、Pi拡張との接続、テストの手順は [プロジェクトのREADME](../../README.md) を参照してください。

- `photosync_page.dart`: 接続と送信画面
- `receiver_controller.dart`: SSE接続、送信先一覧と選択状態
- `receiver_event.dart`: SSE通知の読み取り
- `photosync_client.dart`: Pi拡張への画像送信とSSE通信
- `memory_camera.dart`: ファイルを保存しない撮影
- `frame_encoder.dart`: AndroidのカメラフレームをJPEGへ変換
