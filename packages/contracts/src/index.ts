import { z } from "zod";

export const LivenessResponseSchema = z.object({
  service: z.literal("api"),
  status: z.literal("ok"),
});

export type LivenessResponse = z.infer<typeof LivenessResponseSchema>;

export const ReadinessResponseSchema = z.object({
  checks: z.object({
    database: z.enum(["up", "down"]),
  }),
  service: z.literal("api"),
  status: z.enum(["ready", "unavailable"]),
});

export type ReadinessResponse = z.infer<typeof ReadinessResponseSchema>;

export const GuestIdentityResponseSchema = z.object({
  expiresAt: z.iso.datetime(),
  isNew: z.boolean(),
  participantId: z.uuid(),
});

export type GuestIdentityResponse = z.infer<typeof GuestIdentityResponseSchema>;

export const ApiErrorResponseSchema = z.object({
  code: z.string(),
  message: z.string(),
});

export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;

export const LobbyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);

export const LobbyNameSchema = z.string().trim().min(1).max(100);
export const DisplayNameSchema = z.string().trim().min(1).max(40);

export const CreateLobbyRequestSchema = z.object({
  displayName: DisplayNameSchema,
  name: LobbyNameSchema,
});

export type CreateLobbyRequest = z.infer<typeof CreateLobbyRequestSchema>;

export const JoinLobbyRequestSchema = z.object({
  code: LobbyCodeSchema,
  displayName: DisplayNameSchema,
});

export type JoinLobbyRequest = z.infer<typeof JoinLobbyRequestSchema>;

export const LobbyIdParameterSchema = z.object({
  id: z.uuid(),
});

export const LobbyResponseSchema = z.object({
  code: LobbyCodeSchema,
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  id: z.uuid(),
  invitePath: z.string().regex(/^\/join\/[A-Z2-9]{6}$/),
  memberCount: z.number().int().positive(),
  membership: z.object({
    displayName: DisplayNameSchema,
    isCreator: z.boolean(),
    joinedAt: z.iso.datetime(),
  }),
  name: LobbyNameSchema,
  status: z.literal("open"),
});

export type LobbyResponse = z.infer<typeof LobbyResponseSchema>;

export const CloseLobbyResponseSchema = z.object({
  closedAt: z.iso.datetime(),
  id: z.uuid(),
  status: z.literal("closed"),
});

export type CloseLobbyResponse = z.infer<typeof CloseLobbyResponseSchema>;

export const LobbyRealtimeEventSchema = z.object({
  lobbyId: z.uuid(),
  type: z.literal("lobby.closed"),
});

export type LobbyRealtimeEvent = z.infer<typeof LobbyRealtimeEventSchema>;

export const ProviderCapabilitySchema = z.enum([
  "catalog_search",
  "track_metadata",
  "web_playback",
  "remote_playback_control",
  "pause_resume",
  "seek",
  "queue_control",
  "token_refresh",
  "token_revoke",
]);

export type ProviderCapability = z.infer<typeof ProviderCapabilitySchema>;

export const ProviderCredentialStatusSchema = z.enum([
  "active",
  "expired",
  "revoked",
  "unavailable",
]);

export const ProviderConnectionSummarySchema = z.object({
  capabilities: z.array(ProviderCapabilitySchema),
  credentialStatus: ProviderCredentialStatusSchema,
  displayName: z.string().min(1).max(80),
  id: z.string().min(1).max(200),
  isSimulation: z.boolean(),
  limitations: z.array(z.string().min(1).max(200)).min(1),
  provider: z.string().min(1).max(40),
});

export type ProviderConnectionSummary = z.infer<
  typeof ProviderConnectionSummarySchema
>;

export const ProviderConnectionsResponseSchema = z.object({
  connections: z.array(ProviderConnectionSummarySchema),
});

export type ProviderConnectionsResponse = z.infer<
  typeof ProviderConnectionsResponseSchema
>;

export const CatalogSearchQuerySchema = z.object({
  cursor: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(10),
  q: z.string().trim().min(2).max(100),
});

export type CatalogSearchQuery = z.infer<typeof CatalogSearchQuerySchema>;

export const SearchPlaybackAvailabilitySchema = z.enum([
  "playable",
  "unavailable",
  "unknown",
]);

export const CatalogSearchVariantSchema = z.object({
  connectionId: z.string().min(1).max(200),
  playbackAvailability: SearchPlaybackAvailabilitySchema,
  provider: z.string().min(1).max(40),
  providerTrackId: z.string().min(1).max(300),
});

export const CatalogSearchResultSchema = z.object({
  album: z.string().max(300),
  artists: z.array(z.string().min(1).max(200)).min(1).max(20),
  durationMs: z.number().int().nonnegative().max(86_400_000),
  explicit: z.boolean(),
  id: z.string().min(1).max(100),
  imageUrl: z.url().nullable(),
  isrc: z.string().min(1).max(32).nullable(),
  title: z.string().min(1).max(300),
  variants: z.array(CatalogSearchVariantSchema).min(1).max(20),
});

export const CatalogSearchIssueSchema = z.object({
  code: z.string().min(1).max(100),
  connectionId: z.string().min(1).max(200),
  message: z.string().min(1).max(300),
  provider: z.string().min(1).max(40),
  retryable: z.boolean(),
  type: z.enum(["provider", "failure", "timeout"]),
});

export const CatalogSearchCursorSchema = z.object({
  connectionId: z.string().min(1).max(200),
  cursor: z.string().min(1).max(200),
  provider: z.string().min(1).max(40),
});

export const CatalogSearchResponseSchema = z.object({
  cursors: z.array(CatalogSearchCursorSchema),
  issues: z.array(CatalogSearchIssueSchema),
  results: z.array(CatalogSearchResultSchema),
});

export type CatalogSearchResponse = z.infer<typeof CatalogSearchResponseSchema>;

export const QueueVersionSchema = z.number().int().nonnegative();

export const QueueItemSchema = z.object({
  addedAt: z.iso.datetime(),
  addedByDisplayName: DisplayNameSchema,
  id: z.uuid(),
  track: CatalogSearchResultSchema,
});

export type QueueItem = z.infer<typeof QueueItemSchema>;

export const QueueSnapshotSchema = z.object({
  generatedAt: z.iso.datetime(),
  items: z.array(QueueItemSchema).max(200),
  lobbyId: z.uuid(),
  version: QueueVersionSchema,
});

export type QueueSnapshot = z.infer<typeof QueueSnapshotSchema>;

export const AddQueueItemRequestSchema = z.object({
  commandId: z.uuid(),
  expectedVersion: QueueVersionSchema.optional(),
  track: CatalogSearchResultSchema,
});

export type AddQueueItemRequest = z.infer<typeof AddQueueItemRequestSchema>;

export const RemoveQueueItemRequestSchema = z.object({
  commandId: z.uuid(),
  expectedVersion: QueueVersionSchema,
});

export type RemoveQueueItemRequest = z.infer<
  typeof RemoveQueueItemRequestSchema
>;

export const ReorderQueueRequestSchema = z
  .object({
    commandId: z.uuid(),
    expectedVersion: QueueVersionSchema,
    itemIds: z.array(z.uuid()).max(200),
  })
  .superRefine(({ itemIds }, context) => {
    if (new Set(itemIds).size !== itemIds.length) {
      context.addIssue({
        code: "custom",
        message: "Queue item identifiers must be unique",
        path: ["itemIds"],
      });
    }
  });

export type ReorderQueueRequest = z.infer<typeof ReorderQueueRequestSchema>;

export const QueueItemParameterSchema = LobbyIdParameterSchema.extend({
  itemId: z.uuid(),
});

export const QueueMutationResponseSchema = z.object({
  replayed: z.boolean(),
  snapshot: QueueSnapshotSchema,
});

export type QueueMutationResponse = z.infer<typeof QueueMutationResponseSchema>;

export const QueueErrorResponseSchema = ApiErrorResponseSchema.extend({
  snapshot: QueueSnapshotSchema.optional(),
});

export type QueueErrorResponse = z.infer<typeof QueueErrorResponseSchema>;

export const QueueRealtimeEventSchema = z.object({
  snapshot: QueueSnapshotSchema,
  type: z.enum(["queue.snapshot", "queue.updated"]),
});

export type QueueRealtimeEvent = z.infer<typeof QueueRealtimeEventSchema>;

export const PlayerDeviceIdSchema = z.string().uuid();

export const PlayerSnapshotSchema = z.object({
  currentItem: QueueItemSchema.nullable(),
  lastTransition: z
    .object({
      at: z.iso.datetime(),
      outcome: z.enum(["ended", "failed", "skipped"]),
      title: z.string().min(1).max(300),
    })
    .nullable(),
  lease: z.object({
    expiresAt: z.iso.datetime().nullable(),
    generation: z.number().int().positive().nullable(),
    heldByCurrentDevice: z.boolean(),
    holderDisplayName: DisplayNameSchema.nullable(),
    status: z.enum(["available", "held"]),
  }),
  lobbyId: z.uuid(),
  positionMs: z.number().int().nonnegative(),
  state: z.enum(["idle", "playing", "paused"]),
  version: z.number().int().nonnegative(),
});

export type PlayerSnapshot = z.infer<typeof PlayerSnapshotSchema>;

export const PlayerSnapshotQuerySchema = z.object({
  deviceId: PlayerDeviceIdSchema,
});

export const ClaimPlayerRequestSchema = z.object({
  commandId: z.uuid(),
  deviceId: PlayerDeviceIdSchema,
});

export type ClaimPlayerRequest = z.infer<typeof ClaimPlayerRequestSchema>;

export const PlayerHeartbeatRequestSchema = z.object({
  deviceId: PlayerDeviceIdSchema,
  generation: z.number().int().positive(),
});

export type PlayerHeartbeatRequest = z.infer<
  typeof PlayerHeartbeatRequestSchema
>;

export const PlaybackCommandParameterSchema = LobbyIdParameterSchema.extend({
  command: z.enum(["pause", "resume", "skip", "start"]),
});

export const PlaybackControlRequestSchema = z.object({
  commandId: z.uuid(),
  deviceId: PlayerDeviceIdSchema,
});

export type PlaybackControlRequest = z.infer<
  typeof PlaybackControlRequestSchema
>;

export const PlaybackReportRequestSchema = z.object({
  commandId: z.uuid(),
  deviceId: PlayerDeviceIdSchema,
  generation: z.number().int().positive(),
  outcome: z.enum(["ended", "failed"]),
});

export type PlaybackReportRequest = z.infer<typeof PlaybackReportRequestSchema>;

export const PlayerMutationResponseSchema = z.object({
  queueChanged: z.boolean(),
  replayed: z.boolean(),
  snapshot: PlayerSnapshotSchema,
});

export type PlayerMutationResponse = z.infer<
  typeof PlayerMutationResponseSchema
>;

export const PlayerErrorResponseSchema = ApiErrorResponseSchema.extend({
  snapshot: PlayerSnapshotSchema.optional(),
});

export const PlaybackRealtimeEventSchema = z.object({
  lobbyId: z.uuid(),
  type: z.literal("playback.updated"),
  version: z.number().int().nonnegative(),
});

export type PlaybackRealtimeEvent = z.infer<typeof PlaybackRealtimeEventSchema>;

export const PublicProviderConnectionSchema = z.object({
  capabilities: z.array(ProviderCapabilitySchema),
  consentedForLobby: z.boolean(),
  id: z.uuid(),
  ownerParticipantId: z.uuid(),
  provider: z.string().min(1).max(40),
  revokedAt: z.iso.datetime().nullable(),
});

export type PublicProviderConnection = z.infer<
  typeof PublicProviderConnectionSchema
>;
