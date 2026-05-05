import { create } from 'zustand';
import type { Profile } from '../../shared/types.js';
import { profiles as profilesApi } from './api.js';

type ProfileStore = {
  currentProfileId: number | null;
  profiles: Profile[];
  loaded: boolean;
  setCurrent: (id: number | null) => void;
  setProfiles: (profiles: Profile[]) => void;
  loadProfiles: () => Promise<void>;
};

export const useProfileStore = create<ProfileStore>((set) => ({
  currentProfileId: null,
  profiles: [],
  loaded: false,
  setCurrent: (id) => set({ currentProfileId: id }),
  setProfiles: (list) => set({ profiles: list, loaded: true }),
  loadProfiles: async () => {
    const { profiles: list } = await profilesApi.list();
    set({ profiles: list, loaded: true });
  },
}));
