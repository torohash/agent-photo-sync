import 'package:flutter/material.dart';

import 'receiver.dart';

class ReceiverList extends StatelessWidget {
  const ReceiverList({
    super.key,
    required this.receivers,
    required this.selectedId,
    required this.preferredIds,
    required this.onSelect,
  });
  final List<Receiver> receivers;
  final String? selectedId;
  final Set<String> preferredIds;
  final ValueChanged<String>? onSelect;

  @override
  Widget build(BuildContext context) {
    final hosts = receiverHosts(receivers);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final host in hosts) ...[
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Text(
              host.label,
              style: Theme.of(context).textTheme.titleMedium,
            ),
          ),
          for (final receiver in receivers.where(
            (receiver) => receiver.hostId == host.id,
          ))
            Card(
              clipBehavior: Clip.antiAlias,
              color: selectedId == receiver.id
                  ? Theme.of(context).colorScheme.secondaryContainer
                  : null,
              child: Semantics(
                identifier: 'receiver-${receiver.id}',
                child: ListTile(
                  selected: selectedId == receiver.id,
                  leading: Icon(
                    selectedId == receiver.id
                        ? Icons.check_circle
                        : Icons.terminal,
                  ),
                  title: Text('${receiver.project} [${receiver.shortId}]'),
                  subtitle: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(receiver.agentLabel),
                      Text(receiver.cwd),
                      Text(receiver.location),
                      if (receiver.sessionName != null)
                        Text(receiver.sessionName!),
                      Text(
                        '未送信 ${receiver.pending}枚${preferredIds.contains(receiver.id) ? ' · PC側で指定中' : ''}',
                      ),
                    ],
                  ),
                  onTap: onSelect == null ? null : () => onSelect!(receiver.id),
                  trailing: IconButton(
                    tooltip: '受信先の詳細',
                    icon: const Icon(Icons.info_outline),
                    onPressed: () => showDialog<void>(
                      context: context,
                      builder: (context) => AlertDialog(
                        title: Text('${receiver.agentLabel} [${receiver.shortId}]'),
                        content: SelectableText(
                          [
                            'PC: ${receiver.host}',
                            '作業ディレクトリ: ${receiver.cwd}',
                            receiver.location,
                            'PID: ${receiver.pid}',
                            '受信先ID: ${receiver.id}',
                            'セッションID: ${receiver.sessionId}',
                            if (receiver.model != null)
                              'モデル: ${receiver.model}',
                            '接続先: ${receiver.origin}',
                          ].join('\n'),
                        ),
                        actions: [
                          TextButton(
                            onPressed: () => Navigator.pop(context),
                            child: const Text('閉じる'),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ],
    );
  }
}
