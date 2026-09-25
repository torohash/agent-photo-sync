class HerdrLocation {
  const HerdrLocation({
    required this.number,
    required this.name,
    required this.paneId,
  });

  factory HerdrLocation.fromJson(Map<String, dynamic> json) => HerdrLocation(
    number: json['workspaceNumber'] as int,
    name: json['workspaceName'] as String,
    paneId: json['paneId'] as String,
  );

  final int number;
  final String name;
  final String paneId;
}

class SelectionSnapshot {
  const SelectionSnapshot(this.receiverId, this.revision);
  factory SelectionSnapshot.fromJson(Map<String, dynamic> json) =>
      SelectionSnapshot(
        json['receiverId'] as String,
        BigInt.parse(json['revision'] as String),
      );
  final String receiverId;
  final BigInt revision;
}

class Receiver {
  const Receiver({
    required this.agent,
    required this.id,
    required this.shortId,
    required this.origin,
    required this.hostId,
    required this.host,
    required this.cwd,
    required this.project,
    required this.pid,
    required this.terminal,
    required this.sessionId,
    required this.sessionName,
    required this.model,
    required this.herdr,
    required this.selection,
    required this.pending,
  });

  factory Receiver.fromJson(Map<String, dynamic> json, Uri origin) => Receiver(
    agent: json['agent'] as String,
    id: json['id'] as String,
    shortId: json['shortId'] as String,
    origin: origin,
    hostId: json['hostId'] as String,
    host: json['host'] as String,
    cwd: json['cwd'] as String,
    project: json['project'] as String,
    pid: json['pid'] as int,
    terminal: json['terminal'] as String,
    sessionId: json['sessionId'] as String,
    sessionName: json['sessionName'] as String?,
    model: json['model'] as String?,
    herdr: json['herdr'] == null
        ? null
        : HerdrLocation.fromJson(json['herdr'] as Map<String, dynamic>),
    selection: SelectionSnapshot.fromJson(
      json['selection'] as Map<String, dynamic>,
    ),
    pending: json['pending'] as int,
  );

  /// `pi` または `claude-code`。
  final String agent;
  final String id;
  final String shortId;
  final Uri origin;
  final String hostId;
  final String host;
  final String cwd;
  final String project;
  final int pid;
  final String terminal;
  final String sessionId;
  final String? sessionName;
  final String? model;
  final HerdrLocation? herdr;
  final SelectionSnapshot selection;
  final int pending;

  bool get isClaudeCode => agent == 'claude-code';

  String get agentLabel => isClaudeCode ? 'Claude Code' : 'Pi';

  /// 画像を受信した後、AIへ渡すための操作。
  String get deliveryHint => isClaudeCode
      ? 'Claude Codeで「写真を見て」と頼むと画像を読み込みます。'
      : 'PiでEnterを押すと本文と一緒にAIへ送信されます。';

  String get location => herdr == null
      ? '端末: $terminal'
      : 'Herdr: ワークスペース${herdr!.number} / ${herdr!.paneId}';
}

class ReceiverHost {
  const ReceiverHost(this.id, this.name, this.address);
  final String id;
  final String name;
  final String address;
  String get label => '$name · $address';
}

List<ReceiverHost> receiverHosts(Iterable<Receiver> receivers) {
  final hosts = {
    for (final receiver in receivers)
      receiver.hostId: ReceiverHost(
        receiver.hostId,
        receiver.host,
        receiver.origin.host,
      ),
  }.values.toList();
  hosts.sort((a, b) => a.label.compareTo(b.label));
  return hosts;
}
