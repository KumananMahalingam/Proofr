/**
 * Empty states, mirroring the web `EmptyBoards`, `EmptySearch` and
 * `EmptyFavorites`. Same idea: say which of the three situations this is rather
 * than showing one generic blank panel.
 */
import { Pressable, StyleSheet, Text, View } from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";

type Variant = "boards" | "search" | "favorites";

const COPY: Record<
  Variant,
  { icon: keyof typeof MaterialCommunityIcons.glyphMap; title: string; body: string }
> = {
  boards: {
    icon: "notebook-outline",
    title: "Create your first board",
    body: "Start by adding a problem, then work through it by hand and get each line marked as you write.",
  },
  search: {
    icon: "text-search",
    title: "No results",
    body: "Nothing matched that search. Try a different title.",
  },
  favorites: {
    icon: "star-outline",
    title: "No favorite boards",
    body: "Tap the star on a board to keep it here.",
  },
};

export const EmptyState = ({
  variant,
  onCreate,
}: {
  variant: Variant;
  onCreate?: () => void;
}) => {
  const { icon, title, body } = COPY[variant];

  return (
    <View style={styles.root}>
      <View style={styles.iconWrap}>
        <MaterialCommunityIcons name={icon} size={30} color="#60a5fa" />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>

      {variant === "boards" && onCreate && (
        <Pressable onPress={onCreate} style={styles.button}>
          <Text style={styles.buttonText}>New board</Text>
        </Pressable>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  root: { alignItems: "center", paddingTop: 60, paddingHorizontal: 32, gap: 10 },
  iconWrap: {
    width: 60,
    height: 60,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(59,130,246,0.14)",
    borderWidth: 1,
    borderColor: "rgba(59,130,246,0.25)",
    marginBottom: 4,
  },
  title: { color: "#ffffff", fontSize: 17, fontWeight: "700" },
  body: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 13,
    textAlign: "center",
    lineHeight: 19,
  },
  button: {
    marginTop: 10,
    backgroundColor: "#3b82f6",
    borderRadius: 11,
    paddingHorizontal: 22,
    paddingVertical: 12,
  },
  buttonText: { color: "#ffffff", fontWeight: "700" },
});
