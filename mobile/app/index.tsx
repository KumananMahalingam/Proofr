/**
 * Dashboard: workspace boards.
 *
 * Follows the web dashboard's structure rather than inventing a new one:
 *   - a section heading that switches between "Team boards" and "Favorite boards"
 *   - a grid of portrait cards, with the "New board" tile as the first cell
 *   - title search
 *   - per-card favourite star and an overflow menu for rename / delete
 *   - distinct empty states for no-boards, no-search-results, and no-favorites
 *
 * What differs is layout, not information. The web app had a persistent left
 * sidebar for workspace switching, a top navbar with the org switcher and search,
 * and a 4-6 column grid. On a phone that becomes: a compact header, an inline
 * search field, a two-tab filter, and two columns.
 */
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth, useOrganization, useOrganizationList, useUser } from "@clerk/clerk-expo";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "expo-router";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  BoardCard,
  CARD_ASPECT,
  NewBoardTile,
} from "@/components/dashboard/board-card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { RenameDialog } from "@/components/dashboard/rename-dialog";
import { useAdoptActiveOrg } from "@/hooks/use-adopt-active-org";

const GRID_GAP = 12;
const GRID_PADDING = 16;
const COLUMNS = 2;

export default function DashboardScreen() {
  const { orgId, signOut } = useAuth();
  const { isLoaded } = useOrganizationList({
    userMemberships: { infinite: true },
  });

  useAdoptActiveOrg();

  if (!isLoaded) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!orgId) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyTitle}>No workspace</Text>
        <Text style={styles.emptyBody}>
          This account is not in a workspace yet. Create one in the Clerk
          dashboard, or add a create-workspace flow.
        </Text>
        <Pressable onPress={() => signOut()} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Sign out</Text>
        </Pressable>
      </View>
    );
  }

  return <Dashboard orgId={orgId} />;
}

const Dashboard = ({ orgId }: { orgId: string }) => {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { user } = useUser();
  const { signOut } = useAuth();
  const { organization } = useOrganization();

  const [search, setSearch] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<{
    id: Id<"boards">;
    title: string;
  } | null>(null);

  const boards = useQuery(api.boards.get, {
    orgId,
    search: search.trim() || undefined,
    favorites: favoritesOnly ? "true" : undefined,
  });

  const createBoard = useMutation(api.board.create);
  const removeBoard = useMutation(api.board.remove);
  const favorite = useMutation(api.board.favorite);
  const unfavorite = useMutation(api.board.unfavorite);

  const cardWidth = useMemo(
    () =>
      Math.floor(
        (width - GRID_PADDING * 2 - GRID_GAP * (COLUMNS - 1)) / COLUMNS
      ),
    [width]
  );

  const onCreate = async () => {
    setCreating(true);
    try {
      const boardId = await createBoard({ orgId, title: "Untitled" });
      router.push(`/board/${boardId}`);
    } finally {
      setCreating(false);
    }
  };

  const onShowActions = (id: Id<"boards">, title: string) => {
    Alert.alert(title, undefined, [
      { text: "Rename", onPress: () => setRenaming({ id, title }) },
      {
        text: "Delete",
        style: "destructive",
        onPress: () =>
          Alert.alert(
            "Delete board?",
            `"${title}" and everything on it will be permanently deleted.`,
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Delete",
                style: "destructive",
                onPress: () => void removeBoard({ id }),
              },
            ]
          ),
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  // Stands in for the web navbar's Clerk UserButton. A real account screen and a
  // workspace switcher belong here once there is more than sign-out to offer.
  const onAccountMenu = () => {
    Alert.alert(
      user?.primaryEmailAddress?.emailAddress ?? "Account",
      organization?.name ? `Workspace: ${organization.name}` : undefined,
      [
        { text: "Sign out", style: "destructive", onPress: () => void signOut() },
        { text: "Cancel", style: "cancel" },
      ]
    );
  };

  const emptyVariant = search.trim()
    ? "search"
    : favoritesOnly
      ? "favorites"
      : "boards";

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View style={styles.headerText}>
          <Text style={styles.greeting}>
            Hi {user?.firstName ?? "there"}
          </Text>
          <Text style={styles.workspace} numberOfLines={1}>
            {organization?.name ?? "Workspace"}
          </Text>
        </View>

        <Pressable onPress={onAccountMenu} style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(user?.firstName ?? "?").slice(0, 1).toUpperCase()}
          </Text>
        </Pressable>
      </View>

      <View style={styles.searchRow}>
        <MaterialCommunityIcons
          name="magnify"
          size={18}
          color="rgba(255,255,255,0.35)"
        />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search boards"
          placeholderTextColor="rgba(255,255,255,0.3)"
          style={styles.searchInput}
          returnKeyType="search"
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch("")} hitSlop={8}>
            <MaterialCommunityIcons
              name="close-circle"
              size={18}
              color="rgba(255,255,255,0.3)"
            />
          </Pressable>
        )}
      </View>

      <View style={styles.tabs}>
        {[
          { label: "Team boards", value: false },
          { label: "Favorites", value: true },
        ].map((tab) => {
          const active = favoritesOnly === tab.value;
          return (
            <Pressable
              key={tab.label}
              onPress={() => setFavoritesOnly(tab.value)}
              style={[styles.tab, active && styles.tabActive]}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {boards === undefined ? (
        <ActivityIndicator style={styles.loader} />
      ) : (
        <FlatList
          data={boards}
          keyExtractor={(item) => item._id}
          numColumns={COLUMNS}
          columnWrapperStyle={styles.column}
          contentContainerStyle={styles.grid}
          keyboardShouldPersistTaps="handled"
          // The "New board" tile is the first grid cell, as on the web. It is a
          // header rather than a data row so it does not disturb the columns.
          ListHeaderComponent={
            favoritesOnly || search.trim() ? null : (
              <View style={styles.newTileRow}>
                <NewBoardTile
                  width={cardWidth}
                  onPress={onCreate}
                  pending={creating}
                />
              </View>
            )
          }
          ListEmptyComponent={
            <EmptyState variant={emptyVariant} onCreate={onCreate} />
          }
          renderItem={({ item }) => (
            <BoardCard
              id={item._id}
              title={item.title}
              authorLabel={
                item.authorId === user?.id ? "You" : item.authorName
              }
              createdAt={item._creationTime}
              isFavorite={item.isFavorite}
              width={cardWidth}
              onToggleFavorite={() =>
                void (item.isFavorite
                  ? unfavorite({ id: item._id })
                  : favorite({ id: item._id, orgId }))
              }
              onShowActions={() => onShowActions(item._id, item.title)}
            />
          )}
        />
      )}

      <RenameDialog
        board={renaming}
        onClose={() => setRenaming(null)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0f0f1a" },
  centered: {
    flex: 1,
    backgroundColor: "#0f0f1a",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 10,
  },
  emptyTitle: { color: "#fff", fontSize: 20, fontWeight: "700" },
  emptyBody: {
    color: "rgba(255,255,255,0.45)",
    textAlign: "center",
    fontSize: 13,
    lineHeight: 19,
  },
  secondaryButton: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    borderRadius: 11,
    paddingHorizontal: 20,
    paddingVertical: 11,
  },
  secondaryButtonText: { color: "rgba(255,255,255,0.7)" },

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: GRID_PADDING,
    paddingBottom: 14,
  },
  headerText: { flex: 1 },
  greeting: { color: "#ffffff", fontSize: 24, fontWeight: "700" },
  workspace: { color: "rgba(255,255,255,0.4)", fontSize: 13, marginTop: 1 },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#3b82f6",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#fff", fontWeight: "700", fontSize: 15 },

  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: GRID_PADDING,
    paddingHorizontal: 12,
    height: 42,
    borderRadius: 11,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  searchInput: { flex: 1, color: "#fff", fontSize: 14, padding: 0 },

  tabs: {
    flexDirection: "row",
    gap: 6,
    marginHorizontal: GRID_PADDING,
    marginTop: 14,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  tabActive: { backgroundColor: "#3b82f6" },
  tabText: { color: "rgba(255,255,255,0.55)", fontSize: 13, fontWeight: "600" },
  tabTextActive: { color: "#ffffff" },

  loader: { marginTop: 40 },
  grid: { padding: GRID_PADDING, paddingBottom: 40, gap: GRID_GAP },
  column: { gap: GRID_GAP },
  newTileRow: { marginBottom: GRID_GAP },
});
