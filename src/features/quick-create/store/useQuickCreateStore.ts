import { create } from "zustand";

export type QuickCreateEntityType = "payee" | "category" | "account" | "tag";

type QuickCreateState = {
  isOpen: boolean;
  preselectedType: QuickCreateEntityType | null;
  prefillName: string;
  open: (type?: QuickCreateEntityType, name?: string) => void;
  close: () => void;
};

export const useQuickCreateStore = create<QuickCreateState>((set) => ({
  isOpen: false,
  preselectedType: null,
  prefillName: "",
  open: (type, name = "") =>
    set({ isOpen: true, preselectedType: type ?? null, prefillName: name }),
  close: () => set({ isOpen: false, preselectedType: null, prefillName: "" }),
}));
