import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';

const kZbxTeal = Color(0xFF14E0B5);
const kZbxCyan = Color(0xFF22D3EE);
const kZbxBg = Color(0xFF0A1020);
const kZbxAppBar = Color(0xFF0F1A30);
const kZbxSurface = Color(0xFF13203A);
const kZbxBorder = Color(0xFF24345A);
const kZbxMuted = Color(0xFF8693AB);
const kZbxRed = Color(0xFFEF4444);
const kZbxAmber = Color(0xFFF59E0B);
const kZbxEmerald = Color(0xFF10B981);
const kZbxViolet = Color(0xFF8B5CF6);

ThemeData buildZebvixTheme() {
  final base = ThemeData.dark(useMaterial3: true);
  final text = GoogleFonts.interTextTheme(base.textTheme).apply(
    bodyColor: Colors.white,
    displayColor: Colors.white,
  );
  return base.copyWith(
    scaffoldBackgroundColor: kZbxBg,
    colorScheme: const ColorScheme.dark(
      primary: kZbxTeal,
      secondary: kZbxCyan,
      surface: kZbxSurface,
      error: kZbxRed,
      onPrimary: Colors.black,
    ),
    textTheme: text,
    appBarTheme: AppBarTheme(
      backgroundColor: kZbxAppBar,
      foregroundColor: Colors.white,
      surfaceTintColor: kZbxAppBar,
      elevation: 0,
      centerTitle: false,
      iconTheme: const IconThemeData(color: Colors.white),
      titleTextStyle: text.titleMedium?.copyWith(
          fontWeight: FontWeight.w700, color: Colors.white, fontSize: 18),
      systemOverlayStyle: const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.light,
        statusBarBrightness: Brightness.dark,
      ),
    ),
    cardColor: kZbxSurface,
    dividerColor: kZbxBorder,
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: kZbxSurface,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: kZbxBorder),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: kZbxBorder),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: kZbxTeal, width: 2),
      ),
      hintStyle: const TextStyle(color: kZbxMuted),
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: kZbxTeal,
        foregroundColor: Colors.black,
        padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 20),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        textStyle: text.bodyMedium?.copyWith(fontWeight: FontWeight.w700),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        side: const BorderSide(color: kZbxBorder),
        foregroundColor: Colors.white,
        padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 20),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    ),
    snackBarTheme: const SnackBarThemeData(
      backgroundColor: kZbxSurface,
      contentTextStyle: TextStyle(color: Colors.white),
      behavior: SnackBarBehavior.floating,
    ),
  );
}
