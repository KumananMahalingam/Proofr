"use client";

import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import {
  AuthLoading,
  Authenticated,
  ConvexReactClient,
} from "convex/react";
import { LiveblocksProvider } from "@liveblocks/react/suspense";

import { Loading } from "@/components/auth/loading";

interface ConvexClientProviderProps {
  children: React.ReactNode;
};

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL!;

const convex = new ConvexReactClient(convexUrl);

// Rebrand Clerk's built-in "Organization" wording to "Workspace" across the
// prebuilt components (create-organization dialog, organization switcher,
// etc.). Clerk merges these overrides onto its default English strings, so we
// only need to list the keys we want to change.
const clerkLocalization = {
  formFieldLabel__organizationName: "Workspace name",
  formFieldLabel__organizationSlug: "Workspace URL",
  formFieldInputPlaceholder__organizationName: "My workspace",
  createOrganization: {
    title: "Create workspace",
    formButtonSubmit: "Create workspace",
  },
  organizationList: {
    action__createOrganization: "Create workspace",
    createOrganization: "Create workspace",
    titleWithoutPersonal: "Choose a workspace",
  },
  organizationSwitcher: {
    action__createOrganization: "Create workspace",
    action__manageOrganization: "Manage workspace",
    action__closeOrganizationSwitcher: "Close workspace switcher",
    action__openOrganizationSwitcher: "Open workspace switcher",
    notSelected: "No workspace selected",
  },
};

export const ConvexClientProvider = ({
  children,
}: ConvexClientProviderProps) => {
  return (
    <ClerkProvider localization={clerkLocalization}>
      <ConvexProviderWithClerk useAuth={useAuth as any} client={convex}>
        <Authenticated>
          <LiveblocksProvider authEndpoint="/api/liveblocks-auth">
            {children}
          </LiveblocksProvider>
        </Authenticated>
        <AuthLoading>
          <Loading />
        </AuthLoading>
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
};