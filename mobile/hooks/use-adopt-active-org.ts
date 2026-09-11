/**
 * Adopts the user's first Clerk organization as the active one.
 *
 * Clerk starts with no active organization even when the user belongs to one, and
 * both `api.boards.get` and the Liveblocks auth action need an org id. The web app
 * got this from `<OrganizationSwitcher />`, which has no equivalent in
 * `@clerk/clerk-expo` at this version, so it is wired manually.
 *
 * Extracted from the dashboard screen so it can be reused once there is a real
 * workspace switcher.
 */
import { useEffect } from "react";
import { useAuth, useOrganizationList } from "@clerk/clerk-expo";

export function useAdoptActiveOrg() {
  const { orgId } = useAuth();
  const { isLoaded, userMemberships, setActive } = useOrganizationList({
    userMemberships: { infinite: true },
  });

  useEffect(() => {
    if (!isLoaded || orgId) return;

    const first = userMemberships.data?.[0];
    if (first) setActive({ organization: first.organization.id });
  }, [isLoaded, orgId, setActive, userMemberships.data]);
}
