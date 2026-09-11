/**
 * Rename a board.
 *
 * Port of the web `RenameModal`. Written as a custom modal rather than a system
 * prompt because `Alert.prompt` is iOS-only — there is no cross-platform text
 * input in a native alert.
 *
 * Validation matches the Convex mutation, which rejects empty titles and titles
 * over 60 characters. Checking here too means the user sees the limit rather than
 * a thrown mutation.
 */
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useMutation } from "convex/react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const MAX_TITLE = 60;

interface RenameDialogProps {
  board: { id: Id<"boards">; title: string } | null;
  onClose: () => void;
}

export const RenameDialog = ({ board, onClose }: RenameDialogProps) => {
  const update = useMutation(api.board.update);

  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTitle(board?.title ?? "");
    setBusy(false);
  }, [board]);

  const trimmed = title.trim();
  const valid = trimmed.length > 0 && trimmed.length <= MAX_TITLE;

  const onSubmit = async () => {
    if (!board || !valid || busy) return;
    setBusy(true);
    try {
      await update({ id: board.id, title: trimmed });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={board !== null}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        <View style={styles.dialog}>
          <Text style={styles.heading}>Rename board</Text>

          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Board title"
            placeholderTextColor="rgba(255,255,255,0.3)"
            style={styles.input}
            autoFocus
            maxLength={MAX_TITLE}
            onSubmitEditing={onSubmit}
            returnKeyType="done"
          />

          <Text style={styles.counter}>
            {trimmed.length}/{MAX_TITLE}
          </Text>

          <View style={styles.actions}>
            <Pressable onPress={onClose} style={styles.cancel}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={onSubmit}
              disabled={!valid || busy}
              style={[styles.save, (!valid || busy) && styles.disabled]}
            >
              {busy ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.saveText}>Save</Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
  },
  dialog: {
    width: "100%",
    backgroundColor: "#181828",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    padding: 18,
    gap: 10,
  },
  heading: { color: "#fff", fontSize: 16, fontWeight: "700" },
  input: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: "#fff",
  },
  counter: {
    color: "rgba(255,255,255,0.3)",
    fontSize: 11,
    textAlign: "right",
  },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  cancel: { paddingHorizontal: 16, paddingVertical: 11 },
  cancelText: { color: "rgba(255,255,255,0.6)", fontWeight: "600" },
  save: {
    backgroundColor: "#3b82f6",
    borderRadius: 10,
    paddingHorizontal: 22,
    paddingVertical: 11,
    minWidth: 84,
    alignItems: "center",
  },
  saveText: { color: "#fff", fontWeight: "700" },
  disabled: { opacity: 0.45 },
});
