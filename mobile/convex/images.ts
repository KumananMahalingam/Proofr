/**
 * Replacement for `app/api/upload-image/route.ts`.
 *
 * The web route read a multipart form and returned a base64 data URL, which the
 * canvas then wrote into Liveblocks storage. That was fine for pasted
 * screenshots and untenable for phone camera photos: a few megabytes of base64
 * inside a CRDT document that syncs to every peer in the room.
 *
 * Convex file storage replaces it. The client uploads directly to a short-lived
 * signed URL, and only the resulting storage id ends up in the board.
 */
import { v } from "convex/values";

import { mutation, query } from "./_generated/server";

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    return await ctx.storage.generateUploadUrl();
  },
});

export const getUrl = query({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    return await ctx.storage.getUrl(storageId);
  },
});

export const remove = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    await ctx.storage.delete(storageId);
  },
});
