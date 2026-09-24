import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as image;
import 'package:pi_photosync/frame_encoder.dart';

void main() {
  test('行の余白とUVの画素間隔を考慮し、センサーの向きでJPEGを回転する', () {
    final jpeg = encodeFrame(
      CapturedFrame(
        width: 4,
        height: 2,
        rotation: 90,
        planes: [
          FramePlane(
            Uint8List.fromList([76, 76, 76, 76, 0, 0, 76, 76, 76, 76, 0, 0]),
            6,
            1,
          ),
          FramePlane(Uint8List.fromList([85, 0, 85, 0]), 4, 2),
          FramePlane(Uint8List.fromList([255, 0, 255, 0]), 4, 2),
        ],
      ),
    );
    final decoded = image.decodeJpg(jpeg)!;
    expect(decoded.width, 2);
    expect(decoded.height, 4);
    for (final pixel in decoded) {
      expect(pixel.r, greaterThan(240));
      expect(pixel.g, lessThan(10));
      expect(pixel.b, lessThan(10));
    }
  });
}
