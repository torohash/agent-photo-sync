import 'dart:typed_data';

import 'package:image/image.dart' as image;

class FramePlane {
  const FramePlane(this.bytes, this.rowStride, this.pixelStride);
  final Uint8List bytes;
  final int rowStride;
  final int pixelStride;
}

class CapturedFrame {
  const CapturedFrame({
    required this.width,
    required this.height,
    required this.planes,
    required this.rotation,
  });
  final int width;
  final int height;
  final List<FramePlane> planes;
  final int rotation;
}

/// AndroidのYUV420フレームを、ファイルを作らずJPEGへ変換する。
Uint8List encodeFrame(CapturedFrame frame) {
  final output = image.Image(width: frame.width, height: frame.height);
  final yPlane = frame.planes[0];
  final uPlane = frame.planes[1];
  final vPlane = frame.planes[2];
  for (var y = 0; y < frame.height; y++) {
    for (var x = 0; x < frame.width; x++) {
      final luminance =
          yPlane.bytes[y * yPlane.rowStride + x * yPlane.pixelStride];
      final u =
          uPlane.bytes[(y ~/ 2) * uPlane.rowStride +
              (x ~/ 2) * uPlane.pixelStride] -
          128;
      final v =
          vPlane.bytes[(y ~/ 2) * vPlane.rowStride +
              (x ~/ 2) * vPlane.pixelStride] -
          128;
      output.setPixelRgb(
        x,
        y,
        (luminance + 1.402 * v).round().clamp(0, 255),
        (luminance - 0.344136 * u - 0.714136 * v).round().clamp(0, 255),
        (luminance + 1.772 * u).round().clamp(0, 255),
      );
    }
  }
  return image.encodeJpg(image.copyRotate(output, angle: frame.rotation));
}
