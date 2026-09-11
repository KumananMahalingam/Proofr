/**
 * Provider stack for the mobile app: Clerk -> Convex -> Liveblocks.
 */
import React, { type ReactNode, useCallback } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { ClerkProvider, useAuth } from "@clerk/clerk-expo";
import * as SecureStore from "expo-secure-store";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import {
  AuthLoading,
  Authenticated,
  ConvexReactClient,
  Unauthenticated,
  useConvex,
} from "convex/react";
import { LiveList, LiveMap, type LiveObject } from "@liveblocks/client";
import {
  ClientSideSuspense,
  LiveblocksProvider,
  RoomProvider,
} from "@liveblocks/react/suspense";

import { api } from "@/convex/_generated/api";
import type { Layer } from "@/types/canvas";
import { AuthScreen } from "@/components/auth-screen";

const convex = new ConvexReactClient(process.env.EXPO_PUBLIC_CONVEX_URL!, {
  // React Native has no window to listen to; without this the client keeps a
  // websocket open while the app is backgrounded.
  unsavedChangesWarning: false,
});

const tokenCache = {
  async getToken(key: string) {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async saveToken(key: string, value: string) {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch {
      // Non-fatal: the user just has to sign in again next launch.
    }
  },
};

export const AppProviders = ({ children }: { children: ReactNode }) => {
  return (
    <ClerkProvider
      publishableKey={process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!}
      tokenCache={tokenCache}
    >
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <Authenticated>
          <LiveblocksAuthProvider>{children}</LiveblocksAuthProvider>
        </Authenticated>
        <Unauthenticated>
          <AuthScreen />
        </Unauthenticated>
        <AuthLoading>
          <Loading />
        </AuthLoading>
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
};

const LiveblocksAuthProvider = ({ children }: { children: ReactNode }) => {
  const convexClient = useConvex();

  const authEndpoint = useCallback(
    async (room?: string) => {
      if (!room) throw new Error("Missing room id");
      return await convexClient.action(api.liveblocks.auth, { room });
    },
    [convexClient]
  );

  return (
    <LiveblocksProvider authEndpoint={authEndpoint}>
      {children}
    </LiveblocksProvider>
  );
};

export const Room = ({
  children,
  roomId,
}: {
  children: ReactNode;
  roomId: string;
}) => {
  return (
    <RoomProvider
      id={roomId}
      initialPresence={{
        cursor: null,
        selection: [],
        pencilDraft: null,
        penColor: null,
      }}
      initialStorage={{
        layers: new LiveMap<string, LiveObject<Layer>>(),
        layerIds: new LiveList([]),
      }}
    >
      <ClientSideSuspense fallback={<Loading />}>
        {children}
      </ClientSideSuspense>
    </RoomProvider>
  );
};

const Loading = () => (
  <View style={styles.loading}>
    <ActivityIndicator size="large" />
  </View>
);

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
});
