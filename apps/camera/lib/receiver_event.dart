import 'dart:convert';

class ReceiverEvent {
  const ReceiverEvent(this.type, this.data);
  final String type;
  final Map<String, dynamic> data;
}

/// UTF-8の文字やSSEの行が複数の受信チャンクに分かれても、一つの通知へ組み立てる。
Stream<ReceiverEvent> decodeReceiverEvents(Stream<List<int>> bytes) async* {
  String? type;
  final data = <String>[];
  await for (final line
      in bytes.transform(utf8.decoder).transform(const LineSplitter())) {
    if (line.isEmpty) {
      if (type != null) {
        yield ReceiverEvent(
          type,
          jsonDecode(data.join('\n')) as Map<String, dynamic>,
        );
      }
      type = null;
      data.clear();
    } else if (line.startsWith('event:')) {
      type = line.substring(6).trimLeft();
    } else if (line.startsWith('data:')) {
      data.add(line.substring(5).trimLeft());
    }
  }
}
