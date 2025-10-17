import { create } from "zustand";

const useStore = create((set) => ({
  // Prompts management
  prompts: [],
  setPrompts: (prompts) => set({ prompts }),

  // Settings
  settings: {
    aspectRatio: "16:9",
    outputCount: 1,
  },
  setSettings: (settings) =>
    set((state) => ({
      settings: { ...state.settings, ...settings },
    })),

  // Queue management for concurrent generation
  queue: [],
  addToQueue: (prompt) =>
    set((state) => ({
      queue: [...state.queue, prompt],
    })),
  removeFromQueue: () =>
    set((state) => ({
      queue: state.queue.slice(1),
    })),
  clearQueue: () => set({ queue: [] }),

  // Job status
  isRunning: false,
  setIsRunning: (isRunning) => set({ isRunning }),

  // Results
  results: [],
  addResult: (result) =>
    set((state) => ({
      results: [...state.results, result],
    })),
  clearResults: () => set({ results: [] }),
}));

export default useStore;
