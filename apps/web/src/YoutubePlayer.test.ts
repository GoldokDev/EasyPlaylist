import { describe, expect, it, vi } from "vitest";

import {
  stopYoutubePlayer,
  type YoutubePlayerInstance,
} from "./youtube-player-instance.js";

describe("YouTube player ownership", () => {
  it("pauses and mutes the player before destroying it", () => {
    const operations: string[] = [];
    const player: YoutubePlayerInstance = {
      destroy: vi.fn(() => operations.push("destroy")),
      mute: vi.fn(() => operations.push("mute")),
      pauseVideo: vi.fn(() => operations.push("pause")),
      playVideo: vi.fn(),
    };

    stopYoutubePlayer(player);

    expect(operations).toEqual(["pause", "mute", "destroy"]);
  });
});
