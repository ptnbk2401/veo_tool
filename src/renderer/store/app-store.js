import { create } from "zustand";

export const useAppStore = create((set, get) => ({
  // App state
  isInitialized: false,

  // Profiles state
  profiles: [],
  selectedProfile: null,

  // Jobs state
  activeJobs: [],
  jobHistory: [],

  // Progress state
  currentProgress: null,
  logs: [],

  // Config state
  config: null,

  // Actions
  initialize: async () => {
    console.log("Store: Starting initialization...");

    let profiles = [];
    let config = null;
    let jobs = [];

    try {
      // Load profiles
      console.log("Store: Loading profiles...");
      profiles = await window.electronAPI.profiles.list();
      console.log("Store: Loaded profiles:", profiles);
    } catch (error) {
      console.error("Store: Failed to load profiles:", error);
    }

    try {
      // Load config
      console.log("Store: Loading config...");
      config = await window.electronAPI.config.load();
      console.log("Store: Loaded config:", config);
    } catch (error) {
      console.error("Store: Failed to load config:", error);
    }

    try {
      // Load jobs
      console.log("Store: Loading jobs...");
      jobs = await window.electronAPI.automation.listJobs();
      console.log("Store: Loaded jobs:", jobs);
    } catch (error) {
      console.error("Store: Failed to load jobs:", error);
    }

    // Set state regardless of individual failures
    set({
      profiles,
      config,
      activeJobs: jobs,
      isInitialized: true,
    });

    console.log("Store: Initialization complete, final profiles:", profiles);
  },

  // Profile actions
  addProfile: async (profileData) => {
    try {
      const newProfile = await window.electronAPI.profiles.add(profileData);
      set((state) => ({
        profiles: [...state.profiles, newProfile],
      }));
      return newProfile;
    } catch (error) {
      console.error("Failed to add profile:", error);
      throw error;
    }
  },

  removeProfile: async (profileId) => {
    try {
      await window.electronAPI.profiles.remove(profileId);
      set((state) => ({
        profiles: state.profiles.filter((p) => p.id !== profileId),
        selectedProfile:
          state.selectedProfile?.id === profileId
            ? null
            : state.selectedProfile,
      }));
    } catch (error) {
      console.error("Failed to remove profile:", error);
      throw error;
    }
  },

  testProfile: async (profileId) => {
    try {
      const result = await window.electronAPI.profiles.test(profileId);

      // Update profile status in store
      set((state) => ({
        profiles: state.profiles.map((p) =>
          p.id === profileId
            ? {
                ...p,
                sessionStatus: result.sessionStatus,
                lastSessionCheck: new Date().toISOString(),
              }
            : p
        ),
      }));

      return result;
    } catch (error) {
      console.error("Failed to test profile:", error);
      throw error;
    }
  },

  setSelectedProfile: (profile) => {
    set({ selectedProfile: profile });
  },

  // Job actions
  startJob: async (jobConfig) => {
    try {
      const job = await window.electronAPI.automation.start(jobConfig);
      set((state) => ({
        activeJobs: [...state.activeJobs, job],
      }));
      return job;
    } catch (error) {
      console.error("Failed to start job:", error);
      throw error;
    }
  },

  pauseJob: async (jobId) => {
    try {
      await window.electronAPI.automation.pause(jobId);
      set((state) => ({
        activeJobs: state.activeJobs.map((job) =>
          job.id === jobId ? { ...job, status: "paused" } : job
        ),
      }));
    } catch (error) {
      console.error("Failed to pause job:", error);
      throw error;
    }
  },

  resumeJob: async (jobId) => {
    try {
      await window.electronAPI.automation.resume(jobId);
      set((state) => ({
        activeJobs: state.activeJobs.map((job) =>
          job.id === jobId ? { ...job, status: "running" } : job
        ),
      }));
    } catch (error) {
      console.error("Failed to resume job:", error);
      throw error;
    }
  },

  stopJob: async (jobId) => {
    try {
      await window.electronAPI.automation.stop(jobId);
      set((state) => ({
        activeJobs: state.activeJobs.filter((job) => job.id !== jobId),
      }));
    } catch (error) {
      console.error("Failed to stop job:", error);
      throw error;
    }
  },

  // Progress actions
  updateProgress: (progressData) => {
    set({ currentProgress: progressData });
  },

  addLog: (logEntry) => {
    set((state) => ({
      logs: [logEntry, ...state.logs].slice(0, 1000), // Keep last 1000 logs
    }));
  },

  clearLogs: () => {
    set({ logs: [] });
  },

  // Config actions
  updateConfig: async (configUpdates) => {
    try {
      await window.electronAPI.config.save(configUpdates);
      set((state) => ({
        config: { ...state.config, ...configUpdates },
      }));
    } catch (error) {
      console.error("Failed to update config:", error);
      throw error;
    }
  },
}));

// Set up IPC event listeners
if (typeof window !== "undefined" && window.electronAPI) {
  // Progress updates
  window.electronAPI.onProgressUpdate((event, data) => {
    useAppStore.getState().updateProgress(data);
  });

  // Log updates
  window.electronAPI.onLogUpdate((event, data) => {
    useAppStore.getState().addLog(data);
  });

  // Job completion
  window.electronAPI.onStatusUpdate((event, data) => {
    const store = useAppStore.getState();
    if (data.type === "job_complete") {
      store.activeJobs = store.activeJobs.filter(
        (job) => job.id !== data.jobId
      );
      store.jobHistory = [data.job, ...store.jobHistory];
    }
  });
}
