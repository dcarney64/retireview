/**
 * Convenience hook — returns the active profile ID (integer or null for combined).
 * Use it as part of React Query keys so data is automatically cache-isolated
 * per profile and re-fetched whenever the active profile changes.
 *
 *   const pid = useActiveProfile();
 *   useQuery({ queryKey: ['accounts', pid], ... });
 */
import { useProfileStore } from './profileStore';

export function useActiveProfile() {
  return useProfileStore((state) => state.activeProfileId);
}
