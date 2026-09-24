import 'dart:async';

import 'package:camera/camera.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import 'frame_encoder.dart';

class MemoryCamera {
  MemoryCamera(CameraDescription description)
    : controller = CameraController(
        description,
        ResolutionPreset.max,
        enableAudio: false,
        imageFormatGroup: ImageFormatGroup.yuv420,
      );

  final CameraController controller;

  Future<Uint8List> capture() async {
    if (kIsWeb) {
      // WebのXFileはブラウザのBlob。端末の写真フォルダへは保存しない。
      final picture = await controller.takePicture();
      return picture.readAsBytes();
    }
    final frame = Completer<CapturedFrame>();
    final deviceAngle = switch (controller.value.deviceOrientation) {
      DeviceOrientation.portraitUp => 0,
      DeviceOrientation.landscapeLeft => 90,
      DeviceOrientation.portraitDown => 180,
      DeviceOrientation.landscapeRight => 270,
    };
    final description = controller.description;
    final rotation =
        (description.sensorOrientation +
            (description.lensDirection == CameraLensDirection.front
                ? deviceAngle
                : -deviceAngle)) %
        360;
    await controller.startImageStream((image) {
      if (frame.isCompleted) return;
      frame.complete(
        CapturedFrame(
          width: image.width,
          height: image.height,
          rotation: rotation,
          planes: image.planes
              .map(
                (p) => FramePlane(
                  Uint8List.fromList(p.bytes),
                  p.bytesPerRow,
                  p.bytesPerPixel!,
                ),
              )
              .toList(),
        ),
      );
    });
    try {
      final captured = await frame.future;
      await controller.stopImageStream();
      return await compute(encodeFrame, captured);
    } finally {
      if (controller.value.isStreamingImages) {
        await controller.stopImageStream();
      }
    }
  }
}
