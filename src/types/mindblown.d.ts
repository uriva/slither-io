export interface MindblownViewer {
  id: string;
  username: string;
  signedIn: boolean;
  onchange?: (fn: (viewer: MindblownViewer) => void) => () => void;
}

export interface MindblownRun {
  start: () => void;
  pause?: () => void;
  resume?: () => void;
  end: (props?: Record<string, unknown>) => void;
}

export interface MindblownLeaderboard {
  submit: (metric: string, value: number, opts?: { lower?: boolean }) => Promise<void>;
  top: (metric: string, opts?: { limit?: number }) => Promise<unknown[]>;
  mine: (metric: string) => Promise<unknown>;
}

export interface MindblownSound {
  on: boolean;
  set: (next: boolean) => boolean;
  toggle: () => boolean;
  onchange?: (fn: (on: boolean) => void) => () => void;
}

export interface MindblownSDK {
  viewer?: MindblownViewer;
  run?: MindblownRun;
  leaderboard?: MindblownLeaderboard;
  sound?: MindblownSound;
  event?: (name: string, props?: Record<string, unknown>) => void;
  events?: Array<[string, Record<string, unknown>?]>;
  shareUrl?: (extra?: Record<string, unknown>) => string;
}

declare global {
  interface Window {
    mindblown?: MindblownSDK;
  }
}
