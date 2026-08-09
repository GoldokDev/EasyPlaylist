import { useEffect, useRef, useState } from "react";

interface YoutubePlayerProps {
  onEnded: () => void;
  onFailed: () => void;
  playbackState: "paused" | "playing";
  videoId: string;
}

interface YoutubePlayerInstance {
  destroy(): void;
  mute(): void;
  pauseVideo(): void;
  playVideo(): void;
}

interface YoutubePlayerEvent {
  data: number;
  target: YoutubePlayerInstance;
}

interface YoutubePlayerOptions {
  events: {
    onAutoplayBlocked(): void;
    onError(event: YoutubePlayerEvent): void;
    onReady(event: YoutubePlayerEvent): void;
    onStateChange(event: YoutubePlayerEvent): void;
  };
  height: string;
  playerVars: {
    controls: number;
    origin: string;
    playsinline: number;
    rel: number;
  };
  videoId: string;
  width: string;
}

interface YoutubeApi {
  Player: new (
    element: HTMLElement,
    options: YoutubePlayerOptions,
  ) => YoutubePlayerInstance;
  PlayerState: { ENDED: number };
}

declare global {
  interface Window {
    YT?: YoutubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youtubeApiPromise: Promise<YoutubeApi> | undefined;

export function YoutubePlayer({
  onEnded,
  onFailed,
  playbackState,
  videoId,
}: YoutubePlayerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YoutubePlayerInstance | undefined>(undefined);
  const playerReadyRef = useRef(false);
  const desiredStateRef = useRef(playbackState);
  const onEndedRef = useRef(onEnded);
  const onFailedRef = useRef(onFailed);
  const [status, setStatus] = useState<
    "loading" | "ready" | "blocked" | "failed"
  >("loading");

  desiredStateRef.current = playbackState;
  onEndedRef.current = onEnded;
  onFailedRef.current = onFailed;

  useEffect(() => {
    let active = true;
    const host = hostRef.current;

    if (!host) {
      return;
    }

    setStatus("loading");

    void loadYoutubeApi()
      .then((youtube) => {
        if (!active) {
          return;
        }

        const player = new youtube.Player(host, {
          events: {
            onAutoplayBlocked: () => {
              if (active) {
                setStatus("blocked");
              }
            },
            onError: (event) => {
              if (active) {
                console.warn("YouTube IFrame player error", {
                  code: event.data,
                  videoId,
                });
                setStatus("failed");
                onFailedRef.current();
              }
            },
            onReady: (event) => {
              if (!active) {
                return;
              }

              playerRef.current = event.target;
              playerReadyRef.current = true;
              setStatus("ready");
              applyPlaybackState(event.target, desiredStateRef.current);
            },
            onStateChange: (event) => {
              if (active && event.data === youtube.PlayerState.ENDED) {
                onEndedRef.current();
              }
            },
          },
          height: "360",
          playerVars: {
            controls: 1,
            origin: window.location.origin,
            playsinline: 1,
            rel: 0,
          },
          videoId,
          width: "640",
        });
        playerRef.current = player;
      })
      .catch(() => {
        if (active) {
          setStatus("failed");
          onFailedRef.current();
        }
      });

    return () => {
      active = false;
      const player = playerRef.current;
      player?.pauseVideo();
      player?.mute();
      player?.destroy();
      playerRef.current = undefined;
      playerReadyRef.current = false;
    };
  }, [videoId]);

  useEffect(() => {
    const player = playerRef.current;

    if (player && playerReadyRef.current) {
      applyPlaybackState(player, playbackState);
    }
  }, [playbackState]);

  return (
    <div className="youtube-player" aria-label="Lecteur vidéo YouTube">
      <div className="youtube-player__frame">
        <div ref={hostRef} />
      </div>
      {status === "loading" ? (
        <p className="youtube-player__status" role="status">
          Chargement du lecteur YouTube…
        </p>
      ) : null}
      {status === "blocked" ? (
        <div className="youtube-player__notice" role="status">
          <span>Le navigateur a bloqué le démarrage automatique.</span>
          <button
            type="button"
            onClick={() => {
              playerRef.current?.playVideo();
              setStatus("ready");
            }}
          >
            Activer la lecture
          </button>
        </div>
      ) : null}
      {status === "failed" ? (
        <p className="youtube-player__error" role="alert">
          Cette vidéo YouTube n’est pas disponible dans le lecteur intégré.
        </p>
      ) : null}
      <p className="youtube-player__policy">
        La vidéo et les contrôles YouTube restent visibles. La lecture audio
        seule ou en arrière-plan n’est pas proposée.
      </p>
    </div>
  );
}

function applyPlaybackState(
  player: YoutubePlayerInstance,
  playbackState: YoutubePlayerProps["playbackState"],
) {
  if (playbackState === "paused") {
    player.pauseVideo();
  } else {
    player.playVideo();
  }
}

function loadYoutubeApi(): Promise<YoutubeApi> {
  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }

  if (youtubeApiPromise) {
    return youtubeApiPromise;
  }

  youtubeApiPromise = new Promise<YoutubeApi>((resolve, reject) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousReady?.();

      if (window.YT?.Player) {
        resolve(window.YT);
      } else {
        reject(new Error("YouTube IFrame API unavailable"));
      }
    };

    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://www.youtube.com/iframe_api"]',
    );

    if (existing) {
      existing.addEventListener(
        "error",
        () => reject(new Error("Script failed")),
        {
          once: true,
        },
      );
      return;
    }

    const script = document.createElement("script");
    script.async = true;
    script.src = "https://www.youtube.com/iframe_api";
    script.addEventListener("error", () => reject(new Error("Script failed")), {
      once: true,
    });
    document.head.append(script);
  });

  return youtubeApiPromise;
}
