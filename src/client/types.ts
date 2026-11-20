// Minimal shared types for the user-data plugin.
// Expand or re-export richer domain types from your host app as needed.

export interface ViewingHistory {
  id: string;
  title: string;
  studio?: { id: string; name: string };
  performers?: Array<{ id: string; name: string }>;
  tags?: Array<{ id: string; name: string }>;
  viewedAt: number;
  watchDuration?: number;
  totalDuration?: number;
  rewatched?: boolean;
  paths?: { screenshot: string };
  files?: Array<{ duration: number }>;
}

export interface UserAffinityScores {
  tags: Map<string, number>;
  performers: Map<string, number>;
  studios: Map<string, number>;
}
