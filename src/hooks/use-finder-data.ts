import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { checkIsAdmin } from "@/lib/admin.functions";
import { getProfile, listFavorites, type FavoriteRow } from "@/lib/gemini.functions";

type FinderProfile = {
  credits: number;
  subscription_tier: string;
};

const EMPTY_FAVORITES: FavoriteRow[] = [];

export function useFinderData(userId: string | undefined) {
  const getProfileFn = useServerFn(getProfile);
  const listFavFn = useServerFn(listFavorites);
  const checkAdminFn = useServerFn(checkIsAdmin);

  const enabled = !!userId;

  const profileQ = useQuery({
    queryKey: ["profile", userId],
    queryFn: () => getProfileFn(),
    enabled,
    staleTime: 2 * 60_000,
  });

  const favsQ = useQuery({
    queryKey: ["favorites", userId],
    queryFn: () => listFavFn(),
    enabled,
    staleTime: 5 * 60_000,
  });

  const adminQ = useQuery({
    queryKey: ["is-admin", userId],
    queryFn: () => checkAdminFn(),
    enabled,
    staleTime: 10 * 60_000,
  });

  return {
    profileQ,
    favsQ,
    adminQ,
    profile: profileQ.data as FinderProfile | undefined,
    favorites: (favsQ.data as FavoriteRow[] | undefined) ?? EMPTY_FAVORITES,
    isAdmin: !!adminQ.data?.isAdmin,
  };
}
