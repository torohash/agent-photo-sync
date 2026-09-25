import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';

import 'photosync_page.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SemanticsBinding.instance.ensureSemantics();
  runApp(const PhotoSyncApp());
}

class PhotoSyncApp extends StatelessWidget {
  const PhotoSyncApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Agent PhotoSync',
    debugShowCheckedModeBanner: false,
    theme: ThemeData(
      colorScheme: ColorScheme.fromSeed(
        seedColor: const Color(0xff238579),
        brightness: Brightness.dark,
      ),
      useMaterial3: true,
      inputDecorationTheme: const InputDecorationTheme(
        border: OutlineInputBorder(),
      ),
    ),
    home: const PhotoSyncPage(),
  );
}
