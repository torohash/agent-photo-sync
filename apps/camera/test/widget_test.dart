import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_photosync/receiver.dart';
import 'package:pi_photosync/receiver_list.dart';

void main() {
  testWidgets('同じ作業フォルダでもHerdrの位置と受信先IDで選び分けられる', (tester) async {
    final receivers = [3, 5]
        .map(
          (number) => Receiver(
            id: 'receiver-$number',
            shortId: 'R$number',
            origin: Uri.parse('http://pc:800$number'),
            hostId: 'pc-a',
            host: 'fedora',
            cwd: '/work/voice-to-list',
            project: 'voice-to-list',
            pid: number,
            terminal: '/dev/pts/$number',
            sessionId: 'session-$number',
            sessionName: null,
            model: null,
            herdr: HerdrLocation(
              number: number,
              name: 'voice-to-list',
              paneId: 'w$number:p1',
            ),
            selection: SelectionSnapshot('', BigInt.zero),
            pending: 0,
          ),
        )
        .toList();
    String? selected;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ReceiverList(
            receivers: receivers,
            selectedId: null,
            preferredIds: const {},
            onSelect: (id) => selected = id,
          ),
        ),
      ),
    );
    expect(find.text('Herdr: ワークスペース3 / w3:p1'), findsOneWidget);
    expect(find.text('Herdr: ワークスペース5 / w5:p1'), findsOneWidget);
    await tester.tap(find.text('voice-to-list [R5]'));
    expect(selected, 'receiver-5');
  });
}
