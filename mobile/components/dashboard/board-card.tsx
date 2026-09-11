/**
 * Board card, following the web `BoardCard` structure.
 *
 * Same anatomy: a portrait tile (the web used aspect-[100/127]) with a preview
 * area on top and a footer carrying the title, author, relative time, and a
 * favourite star.
 *
 * Two departures, both forced:
 *  - The preview is generated from the board id. The web app stored a random
 *    `/placeholders/N.svg` served from `public/`, which does not exist on a
 *    device.
 *  - The web card revealed the author line, star, and overflow menu on hover.
 *    There is no hover on touch, so they are always visible.
 */
import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Canvas, LinearGradient, Rect, vec } from "@shopify/react-native-skia";
import { Link } from "expo-router";

import { formatDistanceToNow, previewColors } from "@/lib/relative-time";

export const CARD_ASPECT = 100 / 127;

interface BoardCardProps {
  id: string;
  title: string;
  authorLabel: string;
  createdAt: number;
  isFavorite: boolean;
  width: number;
  onToggleFavorite: () => void;
  onShowActions: () => void;
}

export const BoardCard = memo(
  ({
    id,
    title,
    authorLabel,
    createdAt,
    isFavorite,
    width,
    onToggleFavorite,
    onShowActions,
  }: BoardCardProps) => {
    const [from, to] = previewColors(id);
    const previewHeight = Math.round((width / CARD_ASPECT) * 0.62);

    // `Link asChild` renders through expo-router's <Slot>, which rejects an array
    // of styles on its child, so this has to be flattened up front.
    const cardStyle = StyleSheet.flatten([styles.card, { width }]);

    return (
      <Link href={`/board/${id}`} asChild>
        <Pressable style={cardStyle}>
          <View style={[styles.preview, { height: previewHeight }]}>
            <Canvas style={StyleSheet.absoluteFill}>
              <Rect x={0} y={0} width={width} height={previewHeight}>
                <LinearGradient
                  start={vec(0, 0)}
                  end={vec(width, previewHeight)}
                  colors={[from, to]}
                />
              </Rect>
            </Canvas>

            <MaterialCommunityIcons
              name="function-variant"
              size={34}
              color="rgba(255,255,255,0.5)"
            />

            <Pressable
              onPress={onShowActions}
              hitSlop={10}
              style={styles.actionsButton}
            >
              <MaterialCommunityIcons
                name="dots-horizontal"
                size={20}
                color="rgba(255,255,255,0.9)"
              />
            </Pressable>
          </View>

          <View style={styles.footer}>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {authorLabel}, {formatDistanceToNow(createdAt)}
            </Text>

            <Pressable
              onPress={onToggleFavorite}
              hitSlop={10}
              style={styles.starButton}
            >
              <MaterialCommunityIcons
                name={isFavorite ? "star" : "star-outline"}
                size={18}
                color={isFavorite ? "#3b82f6" : "rgba(255,255,255,0.35)"}
              />
            </Pressable>
          </View>
        </Pressable>
      </Link>
    );
  }
);

BoardCard.displayName = "BoardCard";

/** First cell of the grid, matching the web `NewBoardButton` tile. */
export const NewBoardTile = ({
  width,
  onPress,
  pending,
}: {
  width: number;
  onPress: () => void;
  pending: boolean;
}) => (
  <Pressable
    onPress={onPress}
    disabled={pending}
    style={[
      styles.newTile,
      { width, height: Math.round(width / CARD_ASPECT) },
      pending && styles.dimmed,
    ]}
  >
    <MaterialCommunityIcons name="plus" size={30} color="#ffffff" />
    <Text style={styles.newTileText}>
      {pending ? "Creating..." : "New board"}
    </Text>
  </Pressable>
);

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: "#181828",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  preview: {
    alignItems: "center",
    justifyContent: "center",
  },
  actionsButton: {
    position: "absolute",
    top: 4,
    right: 4,
    padding: 6,
  },
  footer: { padding: 10, paddingRight: 30, gap: 2 },
  title: { color: "#ffffff", fontSize: 13, fontWeight: "600" },
  meta: { color: "rgba(255,255,255,0.4)", fontSize: 11 },
  starButton: { position: "absolute", top: 10, right: 8, padding: 2 },
  newTile: {
    borderRadius: 14,
    backgroundColor: "#3b82f6",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  newTileText: { color: "#ffffff", fontWeight: "700", fontSize: 13 },
  dimmed: { opacity: 0.6 },
});
