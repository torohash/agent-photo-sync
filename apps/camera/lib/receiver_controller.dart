import 'dart:async';

import 'package:flutter/foundation.dart';

import 'photosync_client.dart';
import 'receiver.dart';
import 'receiver_event.dart';

enum TargetMode { manual, piSelected }

class _ReceiverConnection {
  _ReceiverConnection(this.origin, this.id);
  final Uri origin;
  final abort = Completer<void>();
  StreamSubscription<ReceiverEvent>? subscription;
  String? id;
  bool ready = false;
  bool ended = false;
}

class ReceiverController extends ChangeNotifier {
  ReceiverController(this.client);
  final PhotoSyncClient client;
  final Set<Uri> origins = {};
  final Map<String, Receiver> receivers = {};
  final Map<Uri, _ReceiverConnection> _connections = {};
  final Map<String, Uri> _originsById = {};
  final Map<String, SelectionSnapshot> _selections = {};
  TargetMode mode = TargetMode.manual;
  String? selectedId;
  String? selectedHostId;
  String? connectionError;
  bool _disposed = false;

  bool get refreshing => _connections.values.any((c) => !c.ready && !c.ended);
  List<ReceiverHost> get hosts => receiverHosts(receivers.values);
  ReceiverHost? get selectedHost =>
      {for (final host in hosts) host.id: host}[selectedHostId];
  Set<String> get preferredIds =>
      _selections.values.map((s) => s.receiverId).toSet();

  Receiver? get target {
    final id = mode == TargetMode.manual
        ? selectedId
        : _selections[selectedHostId]?.receiverId;
    return receivers[id];
  }

  void selectMode(TargetMode value) {
    mode = value;
    notifyListeners();
  }

  void selectReceiver(String id) {
    selectedId = id;
    notifyListeners();
  }

  void selectHost(String hostId) {
    selectedHostId = hostId;
    notifyListeners();
  }

  Future<void> connect(Uri origin) async {
    connectionError = null;
    origins.add(origin);
    final existing = _connections[origin];
    if (existing != null && existing.ended) await _closeConnection(existing);
    _open(origin, null);
    notifyListeners();
  }

  /// 明示的な更新操作だけで再接続する。切断時に自動で再試行しない。
  Future<void> refresh() async {
    connectionError = null;
    await Future.wait(_connections.values.toList().map(_closeConnection));
    receivers.clear();
    for (final origin in origins) {
      _open(origin, null);
    }
    notifyListeners();
  }

  Future<void> setOrigins(Set<Uri> values) async {
    final removed = origins.difference(values);
    origins
      ..clear()
      ..addAll(values);
    for (final origin in removed) {
      final connection = _connections[origin];
      if (connection != null) await _closeConnection(connection);
    }
    for (final origin in origins) {
      _open(origin, null);
    }
    notifyListeners();
  }

  void _open(Uri origin, String? id) {
    if (_disposed || _connections.containsKey(origin)) return;
    if (id != null && _originsById.containsKey(id)) return;
    final connection = _ReceiverConnection(origin, id);
    _connections[origin] = connection;
    if (id != null) _originsById[id] = origin;
    connection.subscription = client
        .events(origin, abortTrigger: connection.abort.future)
        .listen(
          (event) => _receive(connection, event),
          onError: (Object error) => _ended(connection, error.toString()),
          onDone: () => _ended(connection, 'Piとの接続が終了しました: $origin'),
          cancelOnError: true,
        );
  }

  void _receive(_ReceiverConnection connection, ReceiverEvent event) {
    if (_disposed || connection.ended) return;
    switch (event.type) {
      case 'snapshot':
        _status(connection, event.data['receiver'] as Map<String, dynamic>);
        if (connection.ended) return;
        for (final peer in event.data['peers'] as List<dynamic>) {
          _open(Uri.parse(peer['url'] as String), peer['id'] as String);
        }
      case 'status':
        _status(connection, event.data);
      case 'peer-up':
        _open(
          Uri.parse(event.data['url'] as String),
          event.data['id'] as String,
        );
      case 'peer-down':
        final origin = _originsById[event.data['id'] as String];
        final lost = _connections[origin];
        if (lost != null) {
          unawaited(_closeConnection(lost));
        }
    }
    notifyListeners();
  }

  void _status(_ReceiverConnection connection, Map<String, dynamic> data) {
    final receiver = Receiver.fromJson(data, connection.origin);
    final duplicateOrigin = _originsById[receiver.id];
    final duplicate = _connections[duplicateOrigin];
    if (duplicate != null && duplicate != connection) {
      if (duplicate.ready) {
        unawaited(_closeConnection(connection));
        return;
      }
      unawaited(_closeConnection(duplicate));
    }
    connection.id = receiver.id;
    connection.ready = true;
    _originsById[receiver.id] = connection.origin;
    receivers[receiver.id] = receiver;
    final previous = _selections[receiver.hostId];
    // 別々のPiから届く通知の順序が入れ替わっても、古い指定へ戻さない。
    if (previous == null || receiver.selection.revision > previous.revision) {
      _selections[receiver.hostId] = receiver.selection;
    }
  }

  void _ended(_ReceiverConnection connection, String message) {
    if (_disposed || connection.ended) return;
    connection.ended = true;
    if (_originsById[connection.id] == connection.origin) {
      receivers.remove(connection.id);
    }
    connectionError = message;
    notifyListeners();
  }

  Future<void> _closeConnection(_ReceiverConnection connection) async {
    connection.ended = true;
    _connections.remove(connection.origin);
    if (_originsById[connection.id] == connection.origin) {
      _originsById.remove(connection.id);
      receivers.remove(connection.id);
    }
    if (!connection.abort.isCompleted) connection.abort.complete();
    await connection.subscription?.cancel();
  }

  @override
  void dispose() {
    _disposed = true;
    for (final connection in _connections.values.toList()) {
      unawaited(_closeConnection(connection));
    }
    super.dispose();
  }
}
