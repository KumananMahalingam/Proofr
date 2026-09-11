/**
 * Home: pick a workspace, then pick or create a board.
 *
 * This is the minimum needed to reach the canvas, and it exists mainly because
 * two things downstream require an *active organization*:
 *   - `api.boards.get` takes an `orgId`
 *   - the Liveblocks auth action verifies the caller belongs to the board's org
 *
 * The web app got the active org from Clerk's `<OrganizationSwitcher />`, which
 * has no equivalent in `@clerk/clerk-expo@2.20.0`, so selection is wired
 * manually through `useOrganizationList`.
 *
 * Replaces the Expo template home screen. The real dashboard — search,
 * favorites, board cards — is Phase 7.
 */
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useAuth, useOrganizationList, useUser } from "@clerk/clerk-expo";
import { useMutation, useQuery } from "convex/react";
import { Link, useRouter } from "expo-router";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export default function HomeScreen() {
  const { orgId, signOut } = useAuth();
  const { user } = useUser();

  const { isLoaded, userMemberships, setActive } = useOrganizationList({
    userMemberships: { infinite: true },
  });

  // Clerk starts with no active organization even when the user belongs to one,
  // so adopt the first membership automatically. Without this every Convex board
  // query sits unresolved with `orgId === undefined`.
  useEffect(() => {
    if (!isLoaded || orgId) return;
    const first = userMemberships.data?.[0];
    if (first) setActive({ organization: first.organization.id });
  }, [isLoaded, orgId, setActive, userMemberships.data]);

  if (!isLoaded) return <Centered><ActivityIndicator /></Centered>;

  if (!orgId) {
    return (
      <Centered>
        <Text style={styles.heading}>No workspace</Text>
        <Text style={styles.muted}>
          This account has no workspace yet. Create one in the Clerk dashboard,
          or add a create-workspace flow in Phase 7.
        </Text>
        <Pressable style={styles.secondary} onPress={() => signOut()}>
          <Text style={styles.secondaryText}>Sign out</Text>
        </Pressable>
      </Centered>
    );
  }

  return <BoardList orgId={orgId} userName={user?.firstName ?? "there"} />;
}

const BoardList = ({
  orgId,
  userName,
}: {
  orgId: string;
  userName: string;
}) => {
  const router = useRouter();
  const boards = useQuery(api.boards.get, { orgId });
  const createBoard = useMutation(api.board.create);
  const removeBoard = useMutation(api.board.remove);
  const [creating, setCreating] = useState(false);

  // Deleting a board is irreversible and takes all its canvas contents with it,
  // so it is behind a confirmation rather than a single tap.
  const confirmDelete = (boardId: Id<"boards">, title: string) => {
    Alert.alert(
      "Delete board?",
      `"${title}" and everything on it will be permanently deleted.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => void removeBoard({ id: boardId }),
        },
      ]
    );
  };

  const onCreate = async () => {
    setCreating(true);
    try {
      const boardId = await createBoard({ orgId, title: "Untitled" });
      router.push(`/board/${boardId}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <View style={styles.root}>
      <Text style={styles.heading}>Hi {userName}</Text>
      <Text style={styles.muted}>{boards?.length ?? 0} board(s)</Text>

      <Pressable
        style={styles.primary}
        onPress={onCreate}
        disabled={creating}
      >
        <Text style={styles.primaryText}>
          {creating ? "Creating..." : "New board"}
        </Text>
      </Pressable>

      {boards === undefined ? (
        <ActivityIndicator style={styles.loader} />
      ) : (
        <FlatList
          data={boards}
          keyExtractor={(item) => item._id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.muted}>
              No boards yet. Create one to open the canvas.
            </Text>
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Link href={`/board/${item._id}`} asChild>
                <Pressable style={styles.rowMain}>
                  <Text style={styles.rowTitle}>{item.title}</Text>
                  <Text style={styles.rowMeta}>{item.authorName}</Text>
                </Pressable>
              </Link>

              <Pressable
                onPress={() => confirmDelete(item._id, item.title)}
                hitSlop={8}
                style={styles.rowDelete}
              >
                <MaterialCommunityIcons
                  name="trash-can-outline"
                  size={20}
                  color="#f87171"
                />
              </Pressable>
            </View>
          )}
        />
      )}
    </View>
  );
};

const Centered = ({ children }: { children: React.ReactNode }) => (
  <View style={[styles.root, styles.centered]}>{children}</View>
);

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0f0f1a", padding: 24, paddingTop: 64 },
  centered: { alignItems: "center", justifyContent: "center", gap: 12 },
  heading: { color: "#fff", fontSize: 26, fontWeight: "700" },
  muted: { color: "rgba(255,255,255,0.45)", marginTop: 4, textAlign: "center" },
  primary: {
    backgroundColor: "#3b82f6",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 20,
  },
  primaryText: { color: "#fff", fontWeight: "700" },
  secondary: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  secondaryText: { color: "rgba(255,255,255,0.7)" },
  loader: { marginTop: 24 },
  list: { paddingTop: 20, gap: 10 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 12,
  },
  rowMain: { flex: 1, padding: 16 },
  rowDelete: { paddingHorizontal: 16, paddingVertical: 18 },
  rowTitle: { color: "#fff", fontWeight: "600", fontSize: 16 },
  rowMeta: { color: "rgba(255,255,255,0.4)", fontSize: 12, marginTop: 2 },
});
