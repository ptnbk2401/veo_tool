import { create } from "zustand";

const useStore = create((set) => ({
  // Prompts management
  prompts: [],
  setPrompts: (prompts) => set({ prompts }),

  // Settings
  settings: {
    // VEO Settings
    mode: "Text to Video",
    aspectRatio: "Landscape (16:9)",
    outputs: 1,
    model: "Veo 3.1 - Fast",
    outputDir: "outputs",
    // Additional Settings
    useSemaphore: false,
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
