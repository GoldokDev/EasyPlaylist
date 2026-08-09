import {
  ApiErrorResponseSchema,
  CatalogSearchResponseSchema,
  CloseLobbyResponseSchema,
  LobbyRealtimeEventSchema,
  LobbyResponseSchema,
  PlaybackRealtimeEventSchema,
  PlayerErrorResponseSchema,
  PlayerMutationResponseSchema,
  PlayerSnapshotSchema,
  QueueErrorResponseSchema,
  QueueMutationResponseSchema,
  QueueRealtimeEventSchema,
  QueueSnapshotSchema,
  ReadinessResponseSchema,
  type CatalogSearchResponse,
  type LobbyResponse,
  type PlayerSnapshot,
  type QueueSnapshot,
} from "@easyplaylist/contracts";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { io } from "socket.io-client";
import { YoutubePlayer } from "./YoutubePlayer";
import { getPlayerDeviceId } from "./player-device";

type ApiState = "checking" | "ready" | "unavailable";
type Submission = "create" | "join" | null;

class ApiRequestError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export function App() {
  const [apiState, setApiState] = useState<ApiState>("checking");
  const [lobby, setLobby] = useState<LobbyResponse>();
  const [loadingLobby, setLoadingLobby] = useState(false);
  const [submission, setSubmission] = useState<Submission>(null);
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [closedLobbyName, setClosedLobbyName] = useState<string>();
  const [closingLobby, setClosingLobby] = useState(false);
  const [updatingSettings, setUpdatingSettings] = useState(false);
  const [routeVersion, setRouteVersion] = useState(0);

  const inviteCode = useMemo(
    () => readInviteCode(window.location.pathname),
    [],
  );

  useEffect(() => {
    const controller = new AbortController();

    async function checkApi() {
      try {
        const response = await fetch("/api/health/ready", {
          signal: controller.signal,
        });
        const readiness = ReadinessResponseSchema.parse(await response.json());
        setApiState(
          response.ok && readiness.status === "ready" ? "ready" : "unavailable",
        );
      } catch {
        if (!controller.signal.aborted) {
          setApiState("unavailable");
        }
      }
    }

    void checkApi();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const onPopState = () => setRouteVersion((version) => version + 1);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const lobbyId = readLobbyId(window.location.pathname);

    if (!lobbyId) {
      setLobby(undefined);
      setLoadingLobby(false);
      return;
    }

    const controller = new AbortController();
    setLoadingLobby(true);
    setError(undefined);

    void requestLobby(`/api/lobbies/${lobbyId}`, {
      signal: controller.signal,
    })
      .then(setLobby)
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setLobby(undefined);
          setError(messageForError(requestError));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadingLobby(false);
        }
      });

    return () => controller.abort();
  }, [routeVersion]);

  async function submit(
    kind: Exclude<Submission, null>,
    path: string,
    body: Record<string, string>,
  ) {
    setSubmission(kind);
    setError(undefined);

    try {
      const nextLobby = await requestLobby(path, {
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      window.history.pushState({}, "", `/lobbies/${nextLobby.id}`);
      setLobby(nextLobby);
      setClosedLobbyName(undefined);
      setCopied(false);
    } catch (requestError) {
      setError(messageForError(requestError));
    } finally {
      setSubmission(null);
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await submit("create", "/api/lobbies", {
      displayName: String(data.get("displayName") ?? ""),
      name: String(data.get("lobbyName") ?? ""),
    });
  }

  async function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await submit("join", "/api/lobbies/join", {
      code: String(data.get("code") ?? ""),
      displayName: String(data.get("displayName") ?? ""),
    });
  }

  async function copyInvite() {
    if (!lobby) {
      return;
    }

    const inviteUrl = new URL(lobby.invitePath, window.location.origin).href;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
  }

  const showClosedLobby = useCallback(() => {
    if (!lobby) {
      return;
    }

    setClosedLobbyName(lobby.name);
    setLobby(undefined);
    setError(undefined);
    window.history.replaceState({}, "", "/");
  }, [lobby]);

  async function closeLobby() {
    if (
      !lobby ||
      !window.confirm(
        "Fermer définitivement ce lobby ? Les connexions musicales seront supprimées.",
      )
    ) {
      return;
    }

    setClosingLobby(true);
    setError(undefined);

    try {
      const response = await fetch(`/api/lobbies/${lobby.id}`, {
        method: "DELETE",
      });
      const payload: unknown = await response.json();

      if (!response.ok) {
        const apiError = ApiErrorResponseSchema.safeParse(payload);
        throw new ApiRequestError(
          apiError.success ? apiError.data.code : "UNKNOWN",
        );
      }

      CloseLobbyResponseSchema.parse(payload);
      showClosedLobby();
    } catch (requestError) {
      setError(messageForError(requestError));
    } finally {
      setClosingLobby(false);
    }
  }

  async function updateBlindTest(blindTestEnabled: boolean) {
    if (!lobby || updatingSettings) {
      return;
    }

    if (blindTestEnabled) {
      let hasActivity = true;

      try {
        const deviceId = getPlayerDeviceId();
        const [queueResponse, playerResponse] = await Promise.all([
          fetch(`/api/lobbies/${lobby.id}/queue`),
          fetch(
            `/api/lobbies/${lobby.id}/player?deviceId=${encodeURIComponent(deviceId)}`,
          ),
        ]);
        const queue = QueueSnapshotSchema.parse(await queueResponse.json());
        const player = PlayerSnapshotSchema.parse(await playerResponse.json());
        hasActivity =
          (queue.blindTestEnabled
            ? queue.queuedCount > 0
            : queue.items.length > 0) || player.currentItem !== null;
      } catch {
        hasActivity = true;
      }

      if (
        hasActivity &&
        !window.confirm(
          "Activer le blind test maintenant ? Les morceaux déjà vus ne pourront pas redevenir secrets.",
        )
      ) {
        return;
      }
    } else if (
      !window.confirm(
        "Désactiver le blind test ? Le titre courant et toute la file seront de nouveau visibles.",
      )
    ) {
      return;
    }

    setUpdatingSettings(true);
    setError(undefined);

    try {
      const nextLobby = await requestLobby(
        `/api/lobbies/${lobby.id}/settings`,
        {
          body: JSON.stringify({ blindTestEnabled }),
          headers: { "content-type": "application/json" },
          method: "PATCH",
        },
      );
      setLobby(nextLobby);
    } catch (requestError) {
      setError(messageForError(requestError));
    } finally {
      setUpdatingSettings(false);
    }
  }

  const observeLobbySettings = useCallback(
    (blindTestEnabled: boolean, version: number) => {
      setLobby((current) => {
        if (
          !current ||
          current.settings.blindTestEnabled === blindTestEnabled
        ) {
          return current;
        }

        return {
          ...current,
          settings: { blindTestEnabled },
          version,
        };
      });
    },
    [],
  );

  if (loadingLobby) {
    return (
      <main className="shell shell--centered">
        <div className="loader" role="status">
          <span className="status__dot" aria-hidden="true" />
          Reprise du lobby…
        </div>
      </main>
    );
  }

  if (closedLobbyName) {
    return (
      <main className="shell shell--centered">
        <section className="closed-lobby-card" aria-labelledby="closed-title">
          <p className="eyebrow">Lobby fermé</p>
          <h1 id="closed-title">La soirée est terminée.</h1>
          <p>
            « {closedLobbyName} » n’accepte plus d’action. Ses connexions
            musicales ont été purgées.
          </p>
          <a className="button-link" href="/">
            Créer ou rejoindre un lobby
          </a>
        </section>
      </main>
    );
  }

  if (lobby) {
    const inviteUrl = new URL(lobby.invitePath, window.location.origin).href;

    return (
      <main className="shell lobby-shell">
        <header className="topbar">
          <a className="brand" href="/" aria-label="Retour à l’accueil">
            EasyPlaylist
          </a>
          <span className="live-pill">Lobby ouvert</span>
        </header>

        <section className="lobby-card" aria-labelledby="lobby-title">
          <div className="lobby-overview">
            <div>
              <p className="eyebrow">
                {lobby.membership.isCreator
                  ? "Votre soirée"
                  : "Vous avez rejoint"}
              </p>
              <h1 id="lobby-title">{lobby.name}</h1>
              <p className="member-line">
                {lobby.membership.displayName} · {lobby.memberCount}{" "}
                {lobby.memberCount > 1 ? "membres" : "membre"}
              </p>
            </div>

            <details className="lobby-settings">
              <summary>
                <span aria-hidden="true">⚙</span>
                Réglages
              </summary>
              <div className="settings-content">
                <div className="invite-settings">
                  <div>
                    <span className="field-label">Code d’invitation</span>
                    <strong className="lobby-code">{lobby.code}</strong>
                  </div>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={copyInvite}
                  >
                    {copied ? "Invitation copiée ✓" : "Copier l’invitation"}
                  </button>
                  <p className="invite-url">{inviteUrl}</p>
                </div>

                {lobby.membership.isCreator ? (
                  <div className="creator-settings">
                    <div className="lobby-actions lobby-actions--setting">
                      <div>
                        <strong>Mode blind test</strong>
                        <span>
                          Cache la file et les morceaux à tous sauf au lecteur
                          YouTube qui diffuse.
                        </span>
                      </div>
                      <button
                        aria-checked={lobby.settings.blindTestEnabled}
                        aria-label="Mode blind test"
                        className="blind-test-switch"
                        disabled={updatingSettings}
                        role="switch"
                        type="button"
                        onClick={() =>
                          void updateBlindTest(!lobby.settings.blindTestEnabled)
                        }
                      >
                        {updatingSettings
                          ? "Mise à jour…"
                          : lobby.settings.blindTestEnabled
                            ? "Activé"
                            : "Désactivé"}
                      </button>
                    </div>
                    <div className="lobby-actions">
                      <div>
                        <strong>Fermer la soirée</strong>
                        <span>
                          Cette action est définitive et supprime les connexions
                          musicales.
                        </span>
                      </div>
                      <button
                        className="danger-button"
                        disabled={closingLobby}
                        type="button"
                        onClick={() => void closeLobby()}
                      >
                        {closingLobby ? "Fermeture…" : "Fermer le lobby"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </details>
          </div>

          {error ? (
            <p className="error-banner" role="alert">
              {error}
            </p>
          ) : null}

          {lobby.settings.blindTestEnabled ? (
            <div className="blind-test-banner" role="status">
              <span aria-hidden="true">?</span>
              <div>
                <strong>Mode blind test</strong>
                <span>Les morceaux restent secrets. À vous de jouer !</span>
              </div>
            </div>
          ) : null}

          <CollaborativeQueue
            blindTestEnabled={lobby.settings.blindTestEnabled}
            key={lobby.settings.blindTestEnabled ? "blind" : "standard"}
            lobbyId={lobby.id}
            minimumLobbyVersion={lobby.version}
            onLobbyClosed={showClosedLobby}
            onLobbySettingsObserved={observeLobbySettings}
          />
        </section>
      </main>
    );
  }

  const statusLabel = {
    checking: "Connexion…",
    ready: "Service prêt",
    unavailable: "Service indisponible",
  }[apiState];

  return (
    <main className="shell home-shell">
      <section className="home-intro" aria-labelledby="page-title">
        <p className="eyebrow">La soirée appartient au groupe</p>
        <h1 id="page-title">EasyPlaylist</h1>
        <p className="lede">
          Créez un espace en quelques secondes, partagez le code et construisez
          la bande-son ensemble.
        </p>
        <div className={`status status--${apiState}`} role="status">
          <span className="status__dot" aria-hidden="true" />
          {statusLabel}
        </div>
      </section>

      <section className="entry-grid" aria-label="Entrer dans un lobby">
        <form
          className="entry-card entry-card--primary"
          onSubmit={handleCreate}
        >
          <span className="card-kicker">Je lance la soirée</span>
          <h2>Créer un lobby</h2>
          <label>
            <span>Nom de la soirée</span>
            <input
              autoComplete="off"
              maxLength={100}
              name="lobbyName"
              placeholder="Anniversaire de Léa"
              required
            />
          </label>
          <label>
            <span>Votre pseudonyme</span>
            <input
              autoComplete="nickname"
              maxLength={40}
              name="displayName"
              placeholder="Camille"
              required
            />
          </label>
          <button disabled={submission !== null || apiState !== "ready"}>
            {submission === "create" ? "Création…" : "Créer et inviter"}
          </button>
        </form>

        <form className="entry-card" onSubmit={handleJoin}>
          <span className="card-kicker">J’ai déjà un code</span>
          <h2>Rejoindre le groupe</h2>
          <label>
            <span>Code à 6 caractères</span>
            <input
              autoCapitalize="characters"
              autoComplete="off"
              className="code-input"
              defaultValue={inviteCode}
              maxLength={6}
              name="code"
              pattern="[A-HJ-KM-NP-Za-hj-km-np-z2-9]{6}"
              placeholder="AB2C3D"
              required
            />
          </label>
          <label>
            <span>Votre pseudonyme</span>
            <input
              autoComplete="nickname"
              autoFocus={Boolean(inviteCode)}
              maxLength={40}
              name="displayName"
              placeholder="Noor"
              required
            />
          </label>
          <button disabled={submission !== null || apiState !== "ready"}>
            {submission === "join" ? "Entrée…" : "Rejoindre le lobby"}
          </button>
        </form>
      </section>

      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}
    </main>
  );
}

function CollaborativeQueue({
  blindTestEnabled,
  lobbyId,
  minimumLobbyVersion,
  onLobbyClosed,
  onLobbySettingsObserved,
}: {
  blindTestEnabled: boolean;
  lobbyId: string;
  minimumLobbyVersion: number;
  onLobbyClosed: () => void;
  onLobbySettingsObserved: (blindTestEnabled: boolean, version: number) => void;
}) {
  const [snapshot, setSnapshot] = useState<QueueSnapshot>();
  const [realtimeState, setRealtimeState] = useState<
    "connecting" | "degraded" | "live"
  >("connecting");
  const [error, setError] = useState<string>();
  const [addingTrackId, setAddingTrackId] = useState<string>();
  const [addedTrack, setAddedTrack] = useState<{
    id: string;
    title?: string;
  }>();
  const [pendingItemId, setPendingItemId] = useState<string>();
  const addFeedbackTimerRef = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      if (addFeedbackTimerRef.current !== undefined) {
        window.clearTimeout(addFeedbackTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    let active = true;

    async function loadSnapshot() {
      try {
        const response = await fetch(`/api/lobbies/${lobbyId}/queue`);

        if (!response.ok) {
          throw new Error("Queue unavailable");
        }

        const next = QueueSnapshotSchema.parse(await response.json());

        if (active && next.version >= minimumLobbyVersion) {
          onLobbySettingsObserved(next.blindTestEnabled, next.version);
          setSnapshot(next);
          setError(undefined);
        }
      } catch {
        if (active) {
          setError("La file est momentanément indisponible.");
        }
      }
    }

    void loadSnapshot();
    const socket = io({ path: "/socket.io", transports: ["websocket"] });

    socket.on("connect", () => {
      setRealtimeState("connecting");
      socket.emit(
        "queue:join",
        { lobbyId },
        (acknowledgement: { ok?: boolean }) => {
          if (active) {
            setRealtimeState(acknowledgement.ok ? "live" : "degraded");
          }
        },
      );
    });
    socket.on("connect_error", () => setRealtimeState("degraded"));
    socket.on("disconnect", () => setRealtimeState("degraded"));
    socket.on("queue:event", (payload: unknown) => {
      const parsed = QueueRealtimeEventSchema.safeParse(payload);

      if (!parsed.success) {
        void loadSnapshot();
        return;
      }

      if (parsed.data.snapshot.version < minimumLobbyVersion) {
        return;
      }

      onLobbySettingsObserved(
        parsed.data.snapshot.blindTestEnabled,
        parsed.data.snapshot.version,
      );

      setSnapshot((current) => {
        if (
          current &&
          parsed.data.type === "queue.updated" &&
          parsed.data.snapshot.version > current.version + 1
        ) {
          void loadSnapshot();
          return current;
        }

        if (current && parsed.data.snapshot.version < current.version) {
          return current;
        }

        return parsed.data.snapshot;
      });
    });
    socket.on("lobby:event", (payload: unknown) => {
      const parsed = LobbyRealtimeEventSchema.safeParse(payload);

      if (parsed.success && parsed.data.lobbyId === lobbyId) {
        if (parsed.data.type === "lobby.closed") {
          onLobbyClosed();
        } else {
          onLobbySettingsObserved(
            parsed.data.settings.blindTestEnabled,
            parsed.data.version,
          );
        }
      }
    });
    const handleOffline = () => {
      setRealtimeState("degraded");
      socket.disconnect();
    };
    const handleOnline = () => {
      setRealtimeState("connecting");
      socket.connect();
    };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    const polling = window.setInterval(() => void loadSnapshot(), 5_000);

    return () => {
      active = false;
      window.clearInterval(polling);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      socket.disconnect();
    };
  }, [lobbyId, minimumLobbyVersion, onLobbyClosed, onLobbySettingsObserved]);

  async function mutateQueue(
    path: string,
    method: "DELETE" | "POST" | "PUT",
    body: unknown,
  ) {
    setError(undefined);
    const response = await fetch(path, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method,
    });
    const payload: unknown = await response.json();

    if (response.ok) {
      const mutation = QueueMutationResponseSchema.parse(payload);
      setSnapshot(mutation.snapshot);
      return;
    }

    const queueError = QueueErrorResponseSchema.safeParse(payload);

    if (queueError.success && queueError.data.snapshot) {
      setSnapshot(queueError.data.snapshot);
    }

    if (
      queueError.success &&
      ["QUEUE_VERSION_CONFLICT", "QUEUE_ITEM_SET_CONFLICT"].includes(
        queueError.data.code,
      )
    ) {
      throw new Error("La file a changé. Elle vient d’être resynchronisée.");
    }

    throw new Error("Cette action n’a pas pu être appliquée à la file.");
  }

  async function addTrack(track: CatalogSearchResponse["results"][number]) {
    setAddingTrackId(track.id);
    setAddedTrack(undefined);

    try {
      await mutateQueue(`/api/lobbies/${lobbyId}/queue/items`, "POST", {
        commandId: crypto.randomUUID(),
        track,
      });
      setAddedTrack({
        id: track.id,
        ...(blindTestEnabled ? {} : { title: track.title }),
      });

      if (addFeedbackTimerRef.current !== undefined) {
        window.clearTimeout(addFeedbackTimerRef.current);
      }

      addFeedbackTimerRef.current = window.setTimeout(
        () => setAddedTrack(undefined),
        4_000,
      );
      return true;
    } catch (mutationError) {
      setError(readQueueMutationError(mutationError));
      return false;
    } finally {
      setAddingTrackId(undefined);
    }
  }

  async function removeItem(itemId: string) {
    if (!snapshot) {
      return;
    }

    setPendingItemId(itemId);

    try {
      await mutateQueue(
        `/api/lobbies/${lobbyId}/queue/items/${itemId}`,
        "DELETE",
        {
          commandId: crypto.randomUUID(),
          expectedVersion: snapshot.version,
        },
      );
    } catch (mutationError) {
      setError(readQueueMutationError(mutationError));
    } finally {
      setPendingItemId(undefined);
    }
  }

  async function moveItem(itemId: string, direction: -1 | 1) {
    if (!snapshot || snapshot.blindTestEnabled) {
      return;
    }

    const itemIds = snapshot.items.map(({ id }) => id);
    const currentIndex = itemIds.indexOf(itemId);
    const nextIndex = currentIndex + direction;

    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= itemIds.length) {
      return;
    }

    [itemIds[currentIndex], itemIds[nextIndex]] = [
      itemIds[nextIndex] as string,
      itemIds[currentIndex] as string,
    ];
    setPendingItemId(itemId);

    try {
      await mutateQueue(`/api/lobbies/${lobbyId}/queue/order`, "PUT", {
        commandId: crypto.randomUUID(),
        expectedVersion: snapshot.version,
        itemIds,
      });
    } catch (mutationError) {
      setError(readQueueMutationError(mutationError));
    } finally {
      setPendingItemId(undefined);
    }
  }

  return (
    <>
      <PlayerPanel
        lobbyId={lobbyId}
        minimumLobbyVersion={minimumLobbyVersion}
      />

      <section className="queue-panel" aria-labelledby="queue-title">
        <div className="queue-heading">
          <div>
            <p className="field-label">Ordre partagé</p>
            <h2 id="queue-title">File collaborative</h2>
          </div>
          <span
            className={`realtime-state realtime-state--${realtimeState}`}
            role="status"
          >
            {
              {
                connecting: "Connexion…",
                degraded: "Temps réel dégradé",
                live: "Temps réel connecté",
              }[realtimeState]
            }
          </span>
        </div>

        {error ? (
          <p className="queue-error" role="alert">
            {error}
          </p>
        ) : null}

        {!snapshot ? (
          <p className="queue-loading" role="status">
            Chargement de la file…
          </p>
        ) : snapshot.blindTestEnabled ? (
          <div className="blind-queue" role="status">
            <span className="blind-queue__count" aria-hidden="true">
              {snapshot.queuedCount}
            </span>
            <div>
              <h3>
                {snapshot.queuedCount}{" "}
                {snapshot.queuedCount > 1
                  ? "morceaux en attente"
                  : "morceau en attente"}
              </h3>
              <p>La file est secrète pendant le blind test.</p>
            </div>
          </div>
        ) : snapshot.items.length === 0 ? (
          <div className="empty-queue">
            <span aria-hidden="true">♫</span>
            <div>
              <h3>La file attend son premier titre</h3>
              <p>Recherchez un titre plus bas et ajoutez-le au groupe.</p>
            </div>
          </div>
        ) : (
          <ol className="queue-list" aria-label="File musicale">
            {snapshot.items.map((item, index) => (
              <li key={item.id}>
                <span className="queue-position">{index + 1}</span>
                <div className="track-copy">
                  <strong>{item.track.title}</strong>
                  <span>{item.track.artists.join(", ")}</span>
                  <small>Ajouté par {item.addedByDisplayName}</small>
                </div>
                <div className="queue-actions">
                  <button
                    aria-label={`Monter ${item.track.title}`}
                    disabled={index === 0 || pendingItemId !== undefined}
                    type="button"
                    onClick={() => void moveItem(item.id, -1)}
                  >
                    ↑
                  </button>
                  <button
                    aria-label={`Descendre ${item.track.title}`}
                    disabled={
                      index === snapshot.items.length - 1 ||
                      pendingItemId !== undefined
                    }
                    type="button"
                    onClick={() => void moveItem(item.id, 1)}
                  >
                    ↓
                  </button>
                  <button
                    aria-label={`Retirer ${item.track.title}`}
                    className="queue-remove"
                    disabled={pendingItemId !== undefined}
                    type="button"
                    onClick={() => void removeItem(item.id)}
                  >
                    Retirer
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}

        {snapshot ? (
          <p className="queue-version">Version {snapshot.version}</p>
        ) : null}
      </section>

      <SearchPanel
        addedTrack={addedTrack}
        addingTrackId={addingTrackId}
        blindTestEnabled={snapshot?.blindTestEnabled ?? blindTestEnabled}
        lobbyId={lobbyId}
        onAdd={addTrack}
      />
    </>
  );
}

function PlayerPanel({
  lobbyId,
  minimumLobbyVersion,
}: {
  lobbyId: string;
  minimumLobbyVersion: number;
}) {
  const deviceId = useMemo(() => getPlayerDeviceId(), []);
  const [snapshot, setSnapshot] = useState<PlayerSnapshot>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const reportedTransitionRef = useRef<string | undefined>(undefined);
  const playbackSource = snapshot?.blindTestEnabled
    ? snapshot.playbackSource
    : snapshot?.currentItem?.track.variants.find(
        (variant) => variant.playbackAvailability === "playable",
      );

  async function loadSnapshot() {
    try {
      const response = await fetch(
        `/api/lobbies/${lobbyId}/player?deviceId=${encodeURIComponent(deviceId)}`,
      );

      if (!response.ok) {
        throw new Error("Player unavailable");
      }

      const next = PlayerSnapshotSchema.parse(await response.json());

      if (next.lobbyVersion < minimumLobbyVersion) {
        return;
      }

      setSnapshot(next);
      setError(undefined);
    } catch {
      setError("Le lecteur est momentanément indisponible.");
    }
  }

  useEffect(() => {
    void loadSnapshot();
    const socket = io({ path: "/socket.io", transports: ["websocket"] });
    socket.on("connect", () => {
      socket.emit("playback:join", { deviceId, lobbyId });
    });
    socket.on("playback:event", (payload: unknown) => {
      if (PlaybackRealtimeEventSchema.safeParse(payload).success) {
        void loadSnapshot();
      }
    });
    const polling = window.setInterval(() => void loadSnapshot(), 2_000);

    return () => {
      window.clearInterval(polling);
      socket.disconnect();
    };
  }, [deviceId, lobbyId, minimumLobbyVersion]);

  useEffect(() => {
    if (
      !snapshot?.lease.heldByCurrentDevice ||
      snapshot.lease.generation === null
    ) {
      return;
    }

    const generation = snapshot.lease.generation;
    const heartbeat = window.setInterval(() => {
      void mutate(`/api/lobbies/${lobbyId}/player/heartbeat`, {
        deviceId,
        generation,
      }).catch(() => void loadSnapshot());
    }, 2_000);

    return () => window.clearInterval(heartbeat);
  }, [
    deviceId,
    lobbyId,
    snapshot?.lease.generation,
    snapshot?.lease.heldByCurrentDevice,
  ]);

  async function mutate(path: string, body: unknown) {
    const response = await fetch(path, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const payload: unknown = await response.json();

    if (response.ok) {
      const mutation = PlayerMutationResponseSchema.parse(payload);
      setSnapshot(mutation.snapshot);
      setError(undefined);
      return;
    }

    const parsed = PlayerErrorResponseSchema.safeParse(payload);

    if (parsed.success && parsed.data.snapshot) {
      setSnapshot(parsed.data.snapshot);
    }

    throw new Error(
      parsed.success && parsed.data.code === "LEASE_HELD"
        ? "Un autre navigateur diffuse déjà la musique."
        : "La commande de lecture n’a pas pu être appliquée.",
    );
  }

  async function run(action: () => Promise<void>) {
    setPending(true);
    setError(undefined);

    try {
      await action();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "La commande de lecture n’a pas pu être appliquée.",
      );
    } finally {
      setPending(false);
    }
  }

  function control(command: "pause" | "resume" | "skip" | "start") {
    return run(() =>
      mutate(`/api/lobbies/${lobbyId}/playback/${command}`, {
        commandId: crypto.randomUUID(),
        deviceId,
      }),
    );
  }

  function report(outcome: "ended" | "failed") {
    if (snapshot?.lease.generation === null || !snapshot?.lease.generation) {
      return Promise.resolve();
    }

    const reportKey = `${snapshot.currentItem?.id ?? "none"}:${snapshot.lease.generation}:${outcome}`;

    if (reportedTransitionRef.current === reportKey) {
      return Promise.resolve();
    }

    reportedTransitionRef.current = reportKey;
    return run(async () => {
      try {
        await mutate(`/api/lobbies/${lobbyId}/playback/report`, {
          commandId: crypto.randomUUID(),
          deviceId,
          generation: snapshot.lease.generation,
          outcome,
        });
      } catch (reportError) {
        reportedTransitionRef.current = undefined;
        throw reportError;
      }
    });
  }

  return (
    <section className="player-panel" aria-labelledby="player-title">
      <div className="player-heading">
        <div>
          <p className="field-label">Sortie unique</p>
          <h2 id="player-title">Lecteur de la soirée</h2>
        </div>
        <span
          className={`lease-pill lease-pill--${snapshot?.lease.status ?? "available"}`}
        >
          {snapshot?.lease.heldByCurrentDevice
            ? "Cet appareil diffuse"
            : snapshot?.lease.status === "held"
              ? `Diffusé par ${snapshot.lease.holderDisplayName}`
              : "Lecteur disponible"}
        </span>
      </div>

      {error ? (
        <p className="player-error" role="alert">
          {error}
        </p>
      ) : null}

      {snapshot?.currentItem ? (
        <div className="now-playing" aria-live="polite">
          <span className="now-playing__icon" aria-hidden="true">
            ▶
          </span>
          <div>
            <span className="field-label">
              {snapshot.blindTestEnabled ? "Morceau secret" : "Titre courant"}
            </span>
            {snapshot.blindTestEnabled ? (
              <strong>
                Musique de {snapshot.currentItem.addedByDisplayName}
              </strong>
            ) : (
              <>
                <strong>{snapshot.currentItem.track.title}</strong>
                <small>{snapshot.currentItem.track.artists.join(", ")}</small>
              </>
            )}
          </div>
          <span className="playback-state">
            {snapshot.state === "paused" ? "En pause" : "En lecture"}
          </span>
        </div>
      ) : (
        <p className="player-empty">Aucun titre en lecture.</p>
      )}

      {snapshot?.lastTransition ? (
        <p className="player-transition" role="status">
          {transitionLabel(snapshot.lastTransition.outcome)}
          {!snapshot.blindTestEnabled
            ? ` : ${snapshot.lastTransition.title}`
            : null}
        </p>
      ) : null}

      <div className="player-actions">
        {snapshot?.lease.status !== "held" ? (
          <button
            disabled={pending}
            type="button"
            onClick={() =>
              void run(() =>
                mutate(`/api/lobbies/${lobbyId}/player/claim`, {
                  commandId: crypto.randomUUID(),
                  deviceId,
                }),
              )
            }
          >
            Devenir le lecteur
          </button>
        ) : null}
        <button
          disabled={
            pending ||
            snapshot?.lease.status !== "held" ||
            snapshot.state !== "idle"
          }
          type="button"
          onClick={() => void control("start")}
        >
          Démarrer la file
        </button>
        {snapshot?.state === "paused" ? (
          <button
            disabled={pending}
            type="button"
            onClick={() => void control("resume")}
          >
            Reprendre
          </button>
        ) : (
          <button
            disabled={pending || snapshot?.state !== "playing"}
            type="button"
            onClick={() => void control("pause")}
          >
            Pause
          </button>
        )}
        <button
          disabled={pending || !snapshot?.currentItem}
          type="button"
          onClick={() => void control("skip")}
        >
          Passer
        </button>
      </div>

      {snapshot?.lease.heldByCurrentDevice &&
      snapshot.currentItem &&
      playbackSource?.provider === "youtube" ? (
        <YoutubePlayer
          key={playbackSource.providerTrackId}
          playbackState={snapshot.state === "paused" ? "paused" : "playing"}
          videoId={playbackSource.providerTrackId}
          onEnded={() => void report("ended")}
          onFailed={() => void report("failed")}
        />
      ) : null}

      {snapshot?.lease.heldByCurrentDevice &&
      snapshot.currentItem &&
      playbackSource?.provider === "fake" ? (
        <div
          className="simulation-actions"
          aria-label="Simulation du lecteur fake"
        >
          <span>Mode fake :</span>
          <button
            disabled={pending}
            type="button"
            onClick={() => void report("ended")}
          >
            Simuler la fin
          </button>
          <button
            disabled={pending}
            type="button"
            onClick={() => void report("failed")}
          >
            Simuler un échec
          </button>
        </div>
      ) : null}
    </section>
  );
}

function transitionLabel(outcome: "ended" | "failed" | "skipped"): string {
  return {
    ended: "Titre terminé",
    failed: "Titre en échec, file poursuivie",
    skipped: "Titre passé",
  }[outcome];
}

function readQueueMutationError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Cette action n’a pas pu être appliquée à la file.";
}

function SearchPanel({
  addedTrack,
  addingTrackId,
  blindTestEnabled,
  lobbyId,
  onAdd,
}: {
  addedTrack?: { id: string; title?: string };
  addingTrackId?: string;
  blindTestEnabled: boolean;
  lobbyId: string;
  onAdd: (track: CatalogSearchResponse["results"][number]) => Promise<boolean>;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [response, setResponse] = useState<CatalogSearchResponse>();
  const [state, setState] = useState<"idle" | "loading" | "unavailable">(
    "idle",
  );

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const query = String(data.get("query") ?? "").trim();

    if (query.length < 2) {
      return;
    }

    setState("loading");
    setResponse(undefined);

    try {
      const parameters = new URLSearchParams({ limit: "10", q: query });
      const searchResponse = await fetch(
        `/api/lobbies/${lobbyId}/search?${parameters}`,
      );

      if (!searchResponse.ok) {
        throw new Error("Catalog search unavailable");
      }

      setResponse(
        CatalogSearchResponseSchema.parse(await searchResponse.json()),
      );
      setState("idle");
    } catch {
      setState("unavailable");
    }
  }

  async function addResult(result: CatalogSearchResponse["results"][number]) {
    const added = await onAdd(result);

    if (added && blindTestEnabled) {
      setResponse(undefined);
      formRef.current?.reset();
    }
  }

  return (
    <section className="search-panel" aria-labelledby="search-title">
      <div className="search-heading">
        <div>
          <p className="field-label">Catalogue partagé</p>
          <h2 id="search-title">Trouver un titre</h2>
        </div>
        <span className="search-limit">10 résultats max.</span>
      </div>

      <form className="search-form" ref={formRef} onSubmit={handleSearch}>
        <label>
          <span className="sr-only">Titre, artiste ou album</span>
          <input
            autoComplete="off"
            maxLength={100}
            minLength={2}
            name="query"
            placeholder="Titre, artiste ou album"
            required
          />
        </label>
        <button disabled={state === "loading"}>
          {state === "loading" ? "Recherche…" : "Rechercher"}
        </button>
      </form>

      {addedTrack ? (
        <p className="queue-add-feedback" role="status">
          <span aria-hidden="true">✓</span>
          {blindTestEnabled ? (
            <strong>Ton morceau a été ajouté</strong>
          ) : (
            <>
              <strong>{addedTrack.title}</strong> ajouté à la file
            </>
          )}
        </p>
      ) : null}

      {state === "unavailable" ? (
        <p className="search-error" role="alert">
          La recherche est momentanément indisponible. Réessayez dans un
          instant.
        </p>
      ) : null}

      {response?.issues.length ? (
        <div className="search-issues" role="status">
          Certains catalogues n’ont pas répondu complètement. Les résultats
          disponibles restent affichés.
          <ul>
            {response.issues.map((issue) => (
              <li key={`${issue.connectionId}:${issue.code}`}>
                {issue.provider} · {searchIssueLabel(issue)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {response && response.results.length === 0 ? (
        <p className="search-empty" role="status">
          Aucun titre trouvé dans les sources disponibles.
        </p>
      ) : null}

      {response?.results.length ? (
        <ol className="search-results" aria-label="Résultats de recherche">
          {response.results.map((result) => (
            <li key={result.id}>
              <div className="track-copy">
                <strong>{result.title}</strong>
                <span>{result.artists.join(", ")}</span>
                <small>
                  {result.album} · {formatDuration(result.durationMs)}
                  {result.explicit ? " · Explicite" : ""}
                </small>
              </div>
              <div className="track-sources" aria-label="Sources disponibles">
                {result.variants.map((variant) => (
                  <span
                    className={`availability availability--${variant.playbackAvailability}`}
                    key={`${variant.connectionId}:${variant.providerTrackId}`}
                  >
                    {variant.provider} ·{" "}
                    {availabilityLabel(variant.playbackAvailability)}
                  </span>
                ))}
              </div>
              <button
                className={`track-add-button${addedTrack?.id === result.id ? " track-add-button--added" : ""}`}
                disabled={addingTrackId !== undefined}
                type="button"
                onClick={() => void addResult(result)}
              >
                {addingTrackId === result.id
                  ? "Ajout…"
                  : addedTrack?.id === result.id
                    ? "Ajouté ✓"
                    : "Ajouter à la file"}
              </button>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.round(durationMs / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function searchIssueLabel(
  issue: CatalogSearchResponse["issues"][number],
): string {
  if (issue.code === "YOUTUBE_QUOTA_OR_ACCESS_DENIED") {
    return "quota YouTube épuisé ou clé API refusée";
  }

  if (issue.type === "timeout") {
    return "la source n’a pas répondu à temps";
  }

  return "la source est momentanément indisponible";
}

function availabilityLabel(
  availability: CatalogSearchResponse["results"][number]["variants"][number]["playbackAvailability"],
): string {
  return {
    playable: "lecture disponible",
    unavailable: "lecture indisponible",
    unknown: "lecture à confirmer",
  }[availability];
}

async function requestLobby(
  path: string,
  init?: RequestInit,
): Promise<LobbyResponse> {
  const response = await fetch(path, init);
  const payload: unknown = await response.json();

  if (response.ok) {
    return LobbyResponseSchema.parse(payload);
  }

  const apiError = ApiErrorResponseSchema.safeParse(payload);
  throw new ApiRequestError(apiError.success ? apiError.data.code : "UNKNOWN");
}

function messageForError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.code === "LOBBY_UNAVAILABLE") {
      return "Ce code n’est plus disponible. Vérifiez-le auprès de l’organisateur.";
    }

    if (error.code === "LOBBY_NOT_FOUND") {
      return "Ce lobby n’est pas disponible avec cette identité.";
    }

    if (error.code === "INVALID_REQUEST") {
      return "Vérifiez les champs saisis puis réessayez.";
    }
  }

  return "Le service ne répond pas pour le moment. Réessayez dans un instant.";
}

function readInviteCode(pathname: string): string {
  return /^\/join\/([A-Z2-9]{6})$/i.exec(pathname)?.[1]?.toUpperCase() ?? "";
}

function readLobbyId(pathname: string): string | undefined {
  return /^\/lobbies\/([0-9a-f-]{36})$/i.exec(pathname)?.[1];
}
