// Must be first: shims atob/btoa and window event methods before Liveblocks or
// Clerk are evaluated. See polyfills.ts — Liveblocks throws at import time
// without it.
import "@/polyfills";

import { useFonts } from "expo-font";
import { Kalam_400Regular } from "@expo-google-fonts/kalam";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { StyleSheet } from "react-native";

import { AppProviders } from "@/providers/board-providers";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  // `next/font/google` has no RN equivalent, so the note font is loaded at
  // runtime instead of build time. `note-overlay.tsx` references it by the
  // family name "Kalam_400Regular".
  const [fontsLoaded] = useFonts({ Kalam_400Regular });

  if (!fontsLoaded) return null;

  SplashScreen.hideAsync();

  return (
    // GestureHandlerRootView must be the outermost view or no gesture in the
    // canvas will fire. This is the single most common cause of "the pen tool
    // does nothing" on a fresh RN Gesture Handler setup.
    <GestureHandlerRootView style={styles.root}>
      <AppProviders>
        <Stack screenOptions={{ headerShown: false }} />
      </AppProviders>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
