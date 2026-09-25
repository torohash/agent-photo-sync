import 'dart:async';

import 'package:file_selector/file_selector.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:mime/mime.dart';
import 'package:nsd/nsd.dart' as nsd;

import 'camera_panel.dart';
import 'photosync_client.dart';
import 'receiver_controller.dart';
import 'receiver_list.dart';

class PhotoSyncPage extends StatefulWidget {
  const PhotoSyncPage({super.key});

  @override
  State<PhotoSyncPage> createState() => _PhotoSyncPageState();
}

class _PhotoSyncPageState extends State<PhotoSyncPage> {
  final _client = PhotoSyncClient(http.Client());
  late final _receivers = ReceiverController(_client);
  final _address = TextEditingController();
  nsd.Discovery? _discovery;
  bool _sending = false;
  String? _message;
  String? _error;

  @override
  void initState() {
    super.initState();
    _receivers.addListener(_changed);
    if (!kIsWeb) unawaited(_run(_startDiscovery));
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  Future<void> _run(Future<void> Function() action) async {
    if (mounted && _error != null) setState(() => _error = null);
    try {
      await action();
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    }
  }

  Future<void> _startDiscovery() async {
    _discovery = await nsd.startDiscovery(
      '_agent-photosync._tcp',
      ipLookupType: nsd.IpLookupType.v4,
    );
    if (!mounted) {
      await nsd.stopDiscovery(_discovery!);
      return;
    }
    void updateOrigins() {
      final origins = _discovery!.services
          .map(
            (service) => Uri(
              scheme: 'http',
              host: service.addresses!.first.address,
              port: service.port!,
            ),
          )
          .toSet();
      unawaited(_run(() => _receivers.setOrigins(origins)));
    }

    _discovery!.addListener(updateOrigins);
    updateOrigins();
  }

  Future<void> _send(Uint8List bytes, String mimeType) async {
    setState(() {
      _sending = true;
      _message = null;
    });
    try {
      final receiver = _receivers.target;
      if (receiver == null) {
        setState(
          () =>
              _error =
                  '送信先を選択してください。PC側で指定する場合は、Piで /photosync receive を実行するか、Claude Codeに「写真の受信先にして」と頼んでください。',
        );
        return;
      }
      await _client.send(receiver, bytes, mimeType);
      if (!mounted) return;
      setState(
        () => _message =
            '${receiver.agentLabel}: ${receiver.project} [${receiver.shortId}] に画像を送りました。${receiver.deliveryHint}',
      );
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _chooseFile() async {
    final file = await openFile(
      acceptedTypeGroups: [
        const XTypeGroup(
          label: '画像',
          extensions: ['jpg', 'jpeg', 'png'],
          mimeTypes: ['image/jpeg', 'image/png'],
        ),
      ],
    );
    if (file == null) return;
    final bytes = await file.readAsBytes();
    await _send(bytes, lookupMimeType(file.name, headerBytes: bytes)!);
  }

  @override
  void dispose() {
    if (_discovery != null) unawaited(nsd.stopDiscovery(_discovery!));
    _receivers.removeListener(_changed);
    _receivers.dispose();
    _client.close();
    _address.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final target = _receivers.target;
    final canSend = target != null && !_sending;
    final error = _error ?? _receivers.connectionError;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Agent PhotoSync'),
        actions: [
          IconButton(
            tooltip: '送信先を更新',
            onPressed: _receivers.refreshing
                ? null
                : () => _run(_receivers.refresh),
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 820),
          child: ListView(
            padding: const EdgeInsets.all(24),
            children: [
              Text(
                '撮影して、作業中のエージェントへ。',
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: 8),
              const Text(
                'Piでは入力欄に添付され、Enterで本文と一緒にAIへ送信されます。Claude Codeでは「写真を見て」と頼むと画像を読み込みます。',
              ),
              const SizedBox(height: 24),
              if (kIsWeb) ...[
                const Text(
                  'Piでは次のコマンド、Claude CodeではMCPサーバーの環境変数 PHOTOSYNC_WEB_ORIGIN でWeb接続を許可してから、接続先URLを入力してください。',
                ),
                SelectableText('/photosync web-origin ${Uri.base.origin}'),
                const SizedBox(height: 12),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _address,
                        decoration: const InputDecoration(
                          labelText: '受信先の接続先URL',
                          hintText: 'http://192.168.1.10:12345',
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    FilledButton(
                      onPressed: _receivers.refreshing
                          ? null
                          : () => _run(() async {
                              await _receivers.connect(
                                Uri.parse(_address.text),
                              );
                            }),
                      child: const Text('接続'),
                    ),
                  ],
                ),
                const SizedBox(height: 24),
              ],
              SegmentedButton<TargetMode>(
                segments: const [
                  ButtonSegment(
                    value: TargetMode.manual,
                    label: Text('一覧から選ぶ'),
                    icon: Icon(Icons.touch_app),
                  ),
                  ButtonSegment(
                    value: TargetMode.pcSelected,
                    label: Text('PC側で指定'),
                    icon: Icon(Icons.terminal),
                  ),
                ],
                selected: {_receivers.mode},
                onSelectionChanged: _sending
                    ? null
                    : (selection) => _receivers.selectMode(selection.single),
              ),
              if (_receivers.mode == TargetMode.pcSelected) ...[
                const SizedBox(height: 16),
                DropdownButton<String>(
                  isExpanded: true,
                  value: _receivers.selectedHost?.id,
                  hint: const Text('送信するPCを選択'),
                  items: _receivers.hosts
                      .map(
                        (host) => DropdownMenuItem(
                          value: host.id,
                          child: Text(host.label),
                        ),
                      )
                      .toList(),
                  onChanged: _sending
                      ? null
                      : (host) => _receivers.selectHost(host!),
                ),
                const Text('そのPCで受信先に指定したPiまたはClaude Codeへ送ります。'),
              ],
              if (_receivers.refreshing) const LinearProgressIndicator(),
              if (_receivers.receivers.isEmpty)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 24),
                  child: Text(
                    kIsWeb
                        ? '接続中の受信先はありません。Web接続の許可と接続先URLを確認してください。'
                        : '受信先はありません。同じWi-Fi上のPCで、PiかClaude CodeにAgent PhotoSyncを読み込んでください。',
                  ),
                ),
              ReceiverList(
                receivers: _receivers.receivers.values.toList(),
                selectedId: target?.id,
                preferredIds: _receivers.preferredIds,
                onSelect: _receivers.mode == TargetMode.manual && !_sending
                    ? _receivers.selectReceiver
                    : null,
              ),
              const SizedBox(height: 24),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        target == null
                            ? '送信先を選択してください'
                            : '送信先: ${target.host} / ${target.project} [${target.shortId}]',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      const SizedBox(height: 16),
                      CameraPanel(
                        canSend: canSend,
                        onPhoto: (bytes) => _send(bytes, 'image/jpeg'),
                      ),
                      const SizedBox(height: 12),
                      OutlinedButton.icon(
                        onPressed: canSend ? () => _run(_chooseFile) : null,
                        icon: const Icon(Icons.image_outlined),
                        label: const Text('画像ファイルを選んで送信'),
                      ),
                      if (_sending) const LinearProgressIndicator(),
                    ],
                  ),
                ),
              ),
              if (_message != null)
                Padding(
                  padding: const EdgeInsets.only(top: 16),
                  child: Text(_message!, semanticsLabel: _message),
                ),
              if (error != null)
                Padding(
                  padding: const EdgeInsets.only(top: 16),
                  child: SelectableText(
                    error,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
