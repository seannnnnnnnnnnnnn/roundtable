/// <reference types="vite/client" />

type DesktopUpdateStatus = {
  status:
    | "idle"
    | "development"
    | "checking"
    | "current"
    | "downloading"
    | "ready"
    | "manual"
    | "error";
  message: string;
  version: string;
  progress: number;
  availableVersion: string;
  automaticInstallAvailable: boolean;
  manualUrl: string;
};

type DesktopInfo = {
  isDesktop: boolean;
  isPackaged: boolean;
  version: string;
  platform: string;
  arch: string;
  update: DesktopUpdateStatus;
};

interface Window {
  roundtableDesktop?: {
    getInfo: () => Promise<DesktopInfo>;
    checkForUpdates: () => Promise<DesktopUpdateStatus>;
    installUpdate: () => Promise<boolean>;
    openUpdatePage: () => Promise<boolean>;
    onUpdateStatus: (
      listener: (status: DesktopUpdateStatus) => void
    ) => () => void;
  };
}
