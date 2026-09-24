import 'dart:async';
import 'dart:typed_data';

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';

import 'memory_camera.dart';

class CameraPanel extends StatefulWidget {
  const CameraPanel({super.key, required this.canSend, required this.onPhoto});
  final bool canSend;
  final Future<void> Function(Uint8List bytes) onPhoto;

  @override
  State<CameraPanel> createState() => _CameraPanelState();
}

class _CameraPanelState extends State<CameraPanel> with WidgetsBindingObserver {
  List<CameraDescription>? _cameras;
  MemoryCamera? _camera;
  CameraDescription? _selected;
  Future<void>? _closing;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _open(CameraDescription description) async {
    await _closing;
    await _camera?.controller.dispose();
    _camera = MemoryCamera(description);
    _selected = description;
    await _camera!.controller.initialize();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.inactive) {
      _closing = _camera?.controller.dispose();
      setState(() => _camera = null);
    } else if (state == AppLifecycleState.resumed && _selected != null) {
      unawaited(_run(() => _open(_selected!)));
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    unawaited(_camera?.controller.dispose());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = _camera?.controller;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_cameras == null)
          OutlinedButton.icon(
            onPressed: _busy
                ? null
                : () => _run(() async {
                    _cameras = await availableCameras();
                  }),
            icon: const Icon(Icons.camera_alt_outlined),
            label: const Text('カメラを開く'),
          ),
        if (_cameras != null && _cameras!.isEmpty)
          const Text('カメラが見つかりません。画像ファイルを選んで送信を確認できます。'),
        if (_cameras != null && _cameras!.isNotEmpty)
          DropdownButton<CameraDescription>(
            isExpanded: true,
            hint: const Text('使用するカメラを選択'),
            value: _selected,
            items: _cameras!
                .map(
                  (camera) => DropdownMenuItem(
                    value: camera,
                    child: Text(
                      '${camera.lensDirection.name} · ${camera.name}',
                    ),
                  ),
                )
                .toList(),
            onChanged: _busy ? null : (camera) => _run(() => _open(camera!)),
          ),
        if (controller != null && controller.value.isInitialized) ...[
          ClipRRect(
            borderRadius: BorderRadius.circular(16),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 420),
              child: CameraPreview(controller),
            ),
          ),
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: _busy || !widget.canSend
                ? null
                : () => _run(() async {
                    final bytes = await _camera!.capture();
                    await widget.onPhoto(bytes);
                  }),
            icon: const Icon(Icons.camera),
            label: const Text('撮影して送信'),
          ),
        ],
        if (_busy) const LinearProgressIndicator(),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(top: 12),
            child: Text(
              _error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ),
      ],
    );
  }
}
