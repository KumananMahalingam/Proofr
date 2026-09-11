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

  const [fontsLoaded] = useFonts({ Kalam_400Regular });

  if (!fontsLoaded) return null;

  SplashScreen.hideAsync();

  return (
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
