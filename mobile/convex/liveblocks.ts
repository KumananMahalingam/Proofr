"use node";

/**
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

    const userId = identity.subject;

    // The room id is the board id. 
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

    return JSON.parse(body) as { token: string };
  },
});
