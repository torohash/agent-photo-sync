import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:pi_photosync/photosync_client.dart';
import 'package:pi_photosync/receiver_controller.dart';
import 'package:pi_photosync/receiver_event.dart';

class StreamingClient extends http.BaseClient {
  final streams = <int, StreamController<List<int>>>{};
  final requests = <http.BaseRequest>[];
  final bodies = <Uint8List>[];
  final _opened = <int, Completer<void>>{};
  bool fail = false;

  Future<void> whenOpened(int port) {
    if (streams.containsKey(port)) return Future.value();
    return _opened.putIfAbsent(port, Completer<void>.new).future;
  }

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    requests.add(request);
    if (request.method == 'POST') {
      bodies.add(await request.finalize().toBytes());
      return http.StreamedResponse(Stream.value(utf8.encode('{}')), 200);
    }
    if (fail) throw http.ClientException('Failed to fetch', request.url);
    final stream = StreamController<List<int>>();
    streams[request.url.port] = stream;
    _opened.remove(request.url.port)?.complete();
    return http.StreamedResponse(
      stream.stream,
      200,
      headers: {'content-type': 'text/event-stream'},
    );
  }

  void emit(int port, String type, Map<String, dynamic> value) {
    streams[port]!.add(
      utf8.encode('event: $type\ndata: ${jsonEncode(value)}\n\n'),
    );
  }

  @override
  void close() {
    for (final stream in streams.values) {
      unawaited(stream.close());
    }
  }
}

Map<String, dynamic> status(
  String id,
  String selected,
  int revision, {
  int pending = 0,
}) => {
  'id': id,
  'shortId': id,
  'hostId': id == 'c' ? 'pc-b' : 'pc-a',
  'host': 'fedora',
  'cwd': '/work/same',
  'project': 'same',
  'pid': 10,
  'terminal': '/dev/pts/1',
  'sessionId': 'session-$id',
  'sessionName': null,
  'model': null,
  'herdr': null,
  'selection': {'receiverId': selected, 'revision': '$revision'},
  'pending': pending,
};

Future<void> stateChanges(
  ReceiverController controller,
  bool Function() condition,
) {
  if (condition()) return Future.value();
  final done = Completer<void>();
  void listener() {
    if (condition()) {
      controller.removeListener(listener);
      done.complete();
    }
  }

  controller.addListener(listener);
  return done.future.timeout(const Duration(seconds: 2));
}

void main() {
  test('SSEの通知で一覧と指定先を更新し、古い指定が遅れても送信先を戻さない', () async {
    final transport = StreamingClient();
    final client = PhotoSyncClient(transport);
    final controller = ReceiverController(client);
    addTearDown(() {
      controller.dispose();
      client.close();
    });
    await controller.connect(Uri.parse('http://pc-a:1001'));
    await transport.whenOpened(1001);
    transport.emit(1001, 'snapshot', {
      'receiver': status('a', 'b', 1),
      'peers': [
        {'id': 'a', 'url': 'http://pc-a:1001'},
        {'id': 'b', 'url': 'http://pc-a:1002'},
        {'id': 'c', 'url': 'http://pc-b:1003'},
      ],
    });
    await Future.wait([transport.whenOpened(1002), transport.whenOpened(1003)]);
    transport.emit(1002, 'snapshot', {
      'receiver': status('b', 'b', 1),
      'peers': [],
    });
    transport.emit(1003, 'snapshot', {
      'receiver': status('c', 'c', 1),
      'peers': [],
    });
    await stateChanges(controller, () => controller.receivers.length == 3);
    controller.selectReceiver('a');
    final photo = Uint8List.fromList([0, 1, 128, 255]);
    await client.send(controller.target!, photo, 'image/png');
    expect(transport.requests.last.url.path, '/v1/photos/a');
    expect(transport.bodies.single, photo);

    controller.selectMode(TargetMode.piSelected);
    controller.selectHost('pc-a');
    expect(controller.target!.id, 'b');
    transport.emit(1002, 'status', status('b', 'a', 2));
    await stateChanges(controller, () => controller.target!.id == 'a');
    transport.emit(1001, 'status', status('a', 'b', 1, pending: 1));
    await stateChanges(
      controller,
      () => controller.receivers['a']!.pending == 1,
    );
    expect(controller.target!.id, 'a');
    expect(controller.preferredIds, {'a', 'c'});
    expect(controller.hosts.length, 2);

    transport.emit(1001, 'peer-up', {'id': 'd', 'url': 'http://pc-a:1004'});
    await transport.whenOpened(1004);
    transport.emit(1004, 'snapshot', {
      'receiver': status('d', 'a', 2),
      'peers': [],
    });
    await stateChanges(controller, () => controller.receivers.length == 4);
    transport.emit(1002, 'peer-down', {'id': 'd'});
    await stateChanges(controller, () => controller.receivers.length == 3);
    expect(
      transport.requests
          .where((request) => request.method == 'GET')
          .map((r) => r.url.path),
      everyElement('/v1/events'),
    );
    expect(
      transport.requests.where((request) => request.method == 'GET').length,
      4,
    );
  });

  test('接続失敗は一度表示し、明示的な接続操作で再接続できる', () async {
    final transport = StreamingClient()..fail = true;
    final controller = ReceiverController(PhotoSyncClient(transport));
    addTearDown(() {
      controller.dispose();
      transport.close();
    });
    final origin = Uri.parse('http://pc-a:1001');
    await controller.connect(origin);
    await stateChanges(controller, () => controller.connectionError != null);
    expect(controller.connectionError, contains('Failed to fetch'));
    expect(controller.refreshing, isFalse);
    expect(transport.requests.length, 1);
    transport.fail = false;
    await controller.connect(origin);
    await transport.whenOpened(1001);
    transport.emit(1001, 'snapshot', {
      'receiver': status('a', 'a', 1),
      'peers': [],
    });
    await stateChanges(controller, () => controller.receivers.length == 1);
    expect(controller.connectionError, isNull);
    expect(transport.requests.length, 2);
  });

  test('SSEの日本語と複数行データを、1バイトずつの受信から復元する', () async {
    final encoded = utf8.encode(
      'event: status\r\ndata: {"text":"日本語",\r\ndata: "pending":2}\r\n\r\n',
    );
    final events = await decodeReceiverEvents(
      Stream.fromIterable(encoded.map((byte) => [byte])),
    ).toList();
    expect(events.single.type, 'status');
    expect(events.single.data, {'text': '日本語', 'pending': 2});
  });
}
