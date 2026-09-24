import 'dart:typed_data';

import 'package:http/http.dart' as http;

import 'receiver.dart';
import 'receiver_event.dart';

class PhotoSyncClient {
  PhotoSyncClient(this.httpClient);
  final http.Client httpClient;

  Stream<ReceiverEvent> events(
    Uri origin, {
    required Future<void> abortTrigger,
  }) async* {
    final url = origin.resolve('/v1/events');
    final request = http.AbortableRequest(
      'GET',
      url,
      abortTrigger: abortTrigger,
    )..headers['Accept'] = 'text/event-stream';
    final response = await httpClient.send(request);
    if (response.statusCode != 200) {
      throw http.ClientException(await response.stream.bytesToString(), url);
    }
    yield* decodeReceiverEvents(response.stream);
  }

  Future<void> send(Receiver receiver, Uint8List bytes, String mimeType) async {
    final url = receiver.origin.resolve('/v1/photos/${receiver.id}');
    final response = await httpClient.post(
      url,
      headers: {'Content-Type': mimeType},
      body: bytes,
    );
    if (response.statusCode != 200) {
      throw http.ClientException(response.body, url);
    }
  }

  void close() => httpClient.close();
}
