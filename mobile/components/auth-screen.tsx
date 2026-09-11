/**
 * Sign in, sign up, and Google SSO.
 */
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSSO, useSignIn, useSignUp } from "@clerk/clerk-expo";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";

// Required so the OAuth browser tab can hand control back to the app.
WebBrowser.maybeCompleteAuthSession();

type Mode = "signIn" | "signUp";

export const AuthScreen = () => {
  const [mode, setMode] = useState<Mode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [pendingVerification, setPendingVerification] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { signIn, setActive: setSignInActive, isLoaded: signInLoaded } =
    useSignIn();
  const { signUp, setActive: setSignUpActive, isLoaded: signUpLoaded } =
    useSignUp();
  const { startSSOFlow } = useSSO();

  const isLoaded = signInLoaded && signUpLoaded;

  const fail = (err: unknown, fallback: string) => {
    const message =
      err && typeof err === "object" && "errors" in err
        ? ((err as { errors: Array<{ longMessage?: string; message?: string }> })
            .errors?.[0]?.longMessage ??
          (err as { errors: Array<{ message?: string }> }).errors?.[0]
            ?.message ??
          fallback)
        : fallback;
    setError(message);
  };

  const onSignIn = async () => {
    if (!signInLoaded || busy) return;
    setBusy(true);
    setError(null);
    try {
      const attempt = await signIn.create({ identifier: email, password });
      if (attempt.status === "complete") {
        await setSignInActive({ session: attempt.createdSessionId });
      } else {
        setError(`Additional step required: ${attempt.status}`);
      }
    } catch (err) {
      fail(err, "Sign in failed");
    } finally {
      setBusy(false);
    }
  };

  const onSignUp = async () => {
    if (!signUpLoaded || busy) return;
    setBusy(true);
    setError(null);
    try {
      await signUp.create({ emailAddress: email, password });
      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      setPendingVerification(true);
    } catch (err) {
      fail(err, "Sign up failed");
    } finally {
      setBusy(false);
    }
  };

  const onVerify = async () => {
    if (!signUpLoaded || busy) return;
    setBusy(true);
    setError(null);
    try {
      const attempt = await signUp.attemptEmailAddressVerification({ code });
      if (attempt.status === "complete") {
        await setSignUpActive({ session: attempt.createdSessionId });
      } else {
        setError(`Verification incomplete: ${attempt.status}`);
      }
    } catch (err) {
      fail(err, "Invalid code");
    } finally {
      setBusy(false);
    }
  };

  const onGoogle = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await startSSOFlow({
        strategy: "oauth_google",
        // Uses the "mobilenew" scheme from app.json.
        redirectUrl: Linking.createURL("/"),
      });

      if (result.createdSessionId && result.setActive) {
        await result.setActive({ session: result.createdSessionId });
      } else {
        // Happens when Clerk needs more information before creating a session,
        // e.g. a required username or an unverified email.
        setError("Google sign-in needs more information to finish.");
      }
    } catch (err) {
      fail(err, "Google sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  if (pendingVerification) {
    return (
      <Shell title="Check your email" subtitle={`Code sent to ${email}`}>
        <TextInput
          value={code}
          onChangeText={setCode}
          placeholder="6-digit code"
          placeholderTextColor="rgba(255,255,255,0.3)"
          keyboardType="number-pad"
          style={styles.input}
        />
        {error && <Text style={styles.error}>{error}</Text>}
        <Button label="Verify" busy={busy} onPress={onVerify} />
        <Link
          label="Use a different email"
          onPress={() => {
            setPendingVerification(false);
            setCode("");
            setError(null);
          }}
        />
      </Shell>
    );
  }

  return (
    <Shell
      title="Proofr"
      subtitle={
        mode === "signIn" ? "Sign in to your workspace" : "Create an account"
      }
    >
      <View style={styles.tabs}>
        {(["signIn", "signUp"] as Mode[]).map((m) => (
          <Pressable
            key={m}
            onPress={() => {
              setMode(m);
              setError(null);
            }}
            style={[styles.tab, mode === m && styles.tabActive]}
          >
            <Text style={[styles.tabText, mode === m && styles.tabTextActive]}>
              {m === "signIn" ? "Sign in" : "Sign up"}
            </Text>
          </Pressable>
        ))}
      </View>

      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="Email"
        placeholderTextColor="rgba(255,255,255,0.3)"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        style={styles.input}
      />
      <TextInput
        value={password}
        onChangeText={setPassword}
        placeholder="Password"
        placeholderTextColor="rgba(255,255,255,0.3)"
        autoCapitalize="none"
        secureTextEntry
        style={styles.input}
      />

      {error && <Text style={styles.error}>{error}</Text>}

      <Button
        label={mode === "signIn" ? "Sign in" : "Create account"}
        busy={busy || !isLoaded}
        onPress={mode === "signIn" ? onSignIn : onSignUp}
      />

      <View style={styles.dividerRow}>
        <View style={styles.divider} />
        <Text style={styles.dividerText}>or</Text>
        <View style={styles.divider} />
      </View>

      <Pressable
        onPress={onGoogle}
        disabled={busy}
        style={[styles.googleButton, busy && styles.disabled]}
      >
        <Text style={styles.googleText}>Continue with Google</Text>
      </Pressable>
    </Shell>
  );
};

const Shell = ({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) => (
  <KeyboardAvoidingView
    style={styles.root}
    behavior={Platform.OS === "ios" ? "padding" : undefined}
  >
    <ScrollView
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
      {children}
    </ScrollView>
  </KeyboardAvoidingView>
);

const Button = ({
  label,
  busy,
  onPress,
}: {
  label: string;
  busy: boolean;
  onPress: () => void;
}) => (
  <Pressable
    onPress={onPress}
    disabled={busy}
    style={[styles.button, busy && styles.disabled]}
  >
    {busy ? (
      <ActivityIndicator color="#fff" />
    ) : (
      <Text style={styles.buttonText}>{label}</Text>
    )}
  </Pressable>
);

const Link = ({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) => (
  <Pressable onPress={onPress} style={styles.link}>
    <Text style={styles.linkText}>{label}</Text>
  </Pressable>
);

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0f0f1a" },
  scroll: { flexGrow: 1, justifyContent: "center", padding: 24, gap: 12 },
  title: { color: "#fff", fontSize: 32, fontWeight: "700" },
  subtitle: { color: "rgba(255,255,255,0.5)", marginBottom: 8 },
  tabs: {
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 12,
    padding: 4,
    marginBottom: 4,
  },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: "center" },
  tabActive: { backgroundColor: "#3b82f6" },
  tabText: { color: "rgba(255,255,255,0.6)", fontWeight: "600" },
  tabTextActive: { color: "#fff" },
  input: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: "#fff",
  },
  error: { color: "#f87171", fontSize: 13 },
  button: {
    backgroundColor: "#3b82f6",
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
  },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  disabled: { opacity: 0.5 },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  divider: { flex: 1, height: 1, backgroundColor: "rgba(255,255,255,0.12)" },
  dividerText: { color: "rgba(255,255,255,0.35)", fontSize: 12 },
  googleButton: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  googleText: { color: "#fff", fontWeight: "600" },
  link: { alignItems: "center", paddingVertical: 8 },
  linkText: { color: "rgba(255,255,255,0.55)", fontSize: 13 },
});
