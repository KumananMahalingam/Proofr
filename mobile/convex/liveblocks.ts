"use node";

/**
 * Replacement for `app/api/liveblocks-auth/route.ts`.
 *
 * Expo has no server, so the room-token endpoint moves into Convex. This is a
 * Convex *action* rather than an HTTP action deliberately: the app's
 * `ConvexReactClient` already carries the Clerk token, so calling it needs no
 * manual header plumbing and no CORS configuration. An HTTP action would work
 * too if you ever need a plain URL, but you'd have to attach the bearer token
 * by hand.
 *
 * The authorisation check is the important part. On web it read
 * `authorization.orgId` straight from Clerk's Next helpers. Inside Convex,
 * `ctx.auth.getUserIdentity()` surfaces OIDC claims, and I could not confirm
 * that Clerk's `org_id` reaches it — so rather than ship a security check on an
 * unverified assumption, membership is resolved server-side against the Clerk
 * Backend API. Slower (one extra API call per room join) but verifiable.
 *
 * If you later confirm `org_id` is present in the identity, this collapses to a
 * string comparison and the `@clerk/backend` dependency goes away.
 *
 * Required Convex environment variables:
 *   LIVEBLOCKS_SECRET_KEY
 *   CLERK_SECRET_KEY
 */
import { createClerkClient } from "@clerk/backend";
import { Liveblocks } from "@liveblocks/node";
import { v } from "convex/values";

import { action } from "./_generated/server";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const liveblocks = new Liveblocks({
  secret: process.env.LIVEBLOCKS_SECRET_KEY!,
});

const clerk = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY!,
});

export const auth = action({
  args: { room: v.string() },
  handler: async (ctx, { room }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }

    // Clerk's `sub` claim is the user id (`user_...`).
    const userId = identity.subject;

    // The room id is the board id. It arrives as an untrusted string, so a
    // malformed value must read as "no access" rather than surfacing a raw
    // Convex error to the client.
    let board;
    try {
      board = await ctx.runQuery(api.board.get, {
        id: room as Id<"boards">,
      });
    } catch {
      throw new Error("Unauthorized");
    }

    if (!board) {
      throw new Error("Unauthorized");
    }

    // Never trust a client-supplied org. Ask Clerk whether this user actually
    // belongs to the org that owns this board.
    const memberships = await clerk.users.getOrganizationMembershipList({
      userId,
    });
    const isMember = memberships.data.some(
      (membership) => membership.organization.id === board.orgId
    );

    if (!isMember) {
      throw new Error("Unauthorized");
    }

    const user = await clerk.users.getUser(userId);

    const session = liveblocks.prepareSession(userId, {
      userInfo: {
        name: user.firstName ?? "Teammate",
        picture: user.imageUrl,
      },
    });

    session.allow(room, session.FULL_ACCESS);

    const { body } = await session.authorize();

    // Liveblocks' `authEndpoint` callback expects the parsed `{ token }`
    // object, whereas `authorize()` hands back a JSON string.
    return JSON.parse(body) as { token: string };
  },
});
