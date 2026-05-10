import { create } from "zustand";
import type { Timestamp } from "firebase/firestore";

export interface UserSubscriptionProduct {
  isActive?: boolean;
  isSandbox?: boolean;
  expiresDate?: string;
  store?: string;
  price?: { amount?: number; currency?: string };
  willRenew?: boolean;
  productIdentifier?: string;
  /** RevenueCat: NORMAL, TRIAL, INTRO, etc. */
  periodType?: string;
}

export interface UserRevenueCat {
  activeSubscriptions?: string[];
  latestExpirationDate?: string;
  latestExpirationDateMillis?: number;
  managementURL?: string;
  requestDate?: string;
  firstSeen?: string;
  originalAppUserId?: string;
  subscriptionsByProductIdentifier?: Record<string, UserSubscriptionProduct>;
  entitlements?: {
    active?: Record<
      string,
      {
        identifier?: string;
        isActive?: boolean;
        expirationDate?: string;
        isSandbox?: boolean;
        willRenew?: boolean;
        productIdentifier?: string;
        periodType?: string;
        expirationDateMillis?: number;
      }
    >;
  };
}

export interface UserHealthKit {
  granted?: boolean;
  status?: string;
  canAskAgain?: boolean;
  expires?: string;
  permissions?: {
    read?: Record<string, string>;
    write?: Record<string, unknown>;
  };
}

export interface User {
  id: string;
  email?: string;
  name?: string;
  version?: string;
  gender?: string;
  birthYear?: number;
  platform?: string;
  height?: number;
  currentWeight?: number;
  goalWeight?: number;
  startWeight?: number;
  totalAppsOpen?: number;
  notificationToken?: string;
  lastActiveAt?: Timestamp | null;
  createdAt?: Timestamp | null;
  revenuecat?: UserRevenueCat;
  healthKitPermission?: UserHealthKit;
}

interface UsersState {
  users: User[];
  addUser: (user: User) => void;
  removeUser: (id: string) => void;
  setUsers: (users: User[]) => void;
  fetchUsers: () => Promise<void>;
}

export const useUsersStore = create<UsersState>((set) => ({
  users: [],
  fetchUsers: async () => {
    const { getUsers } = await import("@/services/firebase");
    const users = await getUsers();
    set({ users });
  },
  addUser: (user: User) =>
    set((state) => ({
      users: [...state.users, user],
    })),
  removeUser: (id: string) =>
    set((state) => ({
      users: state.users.filter((user) => user.id !== id),
    })),
  setUsers: (users: User[]) => set(() => ({ users })),
}));
