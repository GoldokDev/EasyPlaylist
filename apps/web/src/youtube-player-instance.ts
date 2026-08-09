export interface YoutubePlayerInstance {
  destroy(): void;
  mute(): void;
  pauseVideo(): void;
  playVideo(): void;
}

export function stopYoutubePlayer(player?: YoutubePlayerInstance) {
  player?.pauseVideo();
  player?.mute();
  player?.destroy();
}
