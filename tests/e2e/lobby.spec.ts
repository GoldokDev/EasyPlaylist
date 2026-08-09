import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

test("creates, shares, joins and resumes a lobby on mobile", async ({
  browser,
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto("/");

  await expect(
    page.getByRole("heading", { level: 1, name: "EasyPlaylist" }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Service prêt");

  const artifactDirectory = resolve("artifacts/validation");
  await mkdir(artifactDirectory, { recursive: true });
  await page.screenshot({
    fullPage: true,
    path: resolve(artifactDirectory, "lobby-001-entry-mobile.png"),
  });
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Nom de la soirée")).toBeFocused();

  await page.getByLabel("Nom de la soirée").fill("Anniversaire de Léa");
  await page
    .locator(".entry-card--primary")
    .getByLabel("Votre pseudonyme")
    .fill("Camille");
  await page.getByRole("button", { name: "Créer et inviter" }).click();

  await expect(
    page.getByRole("heading", { level: 1, name: "Anniversaire de Léa" }),
  ).toBeVisible();
  await expect(page.getByText("Camille · 1 membre")).toBeVisible();
  await expect(page.getByText("Source musicale")).toHaveCount(0);
  await expect(page.getByText("Mode démo")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Lecteur de la soirée" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "File collaborative" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Trouver un titre" }),
  ).toBeVisible();
  const sectionOrder = await page
    .locator(".lobby-card > section")
    .evaluateAll((sections) => sections.map((section) => section.className));
  expect(sectionOrder).toEqual(["player-panel", "queue-panel", "search-panel"]);
  await page.locator(".lobby-settings > summary").click();
  const lobbyId = new URL(page.url()).pathname.split("/").at(-1);
  expect(lobbyId).toMatch(/^[0-9a-f-]{36}$/);
  const code = await page.locator(".lobby-code").innerText();
  expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
  const inviteUrl = await page.locator(".invite-url").innerText();
  expect(inviteUrl).toContain(`/join/${code}`);
  await page.getByRole("button", { name: "Copier l’invitation" }).click();
  await expect(
    page.getByRole("button", { name: "Invitation copiée ✓" }),
  ).toBeVisible();
  await page.screenshot({
    fullPage: true,
    path: resolve(artifactDirectory, "ux-001-settings-mobile.png"),
  });
  await page.locator(".lobby-settings > summary").click();
  await expect(page.locator(".lobby-code")).toBeHidden();

  await page.reload();
  await expect(page.getByText("Camille · 1 membre")).toBeVisible();
  const providerResponse = await page.request.get(
    `/api/lobbies/${lobbyId}/providers`,
  );
  expect(providerResponse.ok()).toBe(true);
  const providerBody = JSON.stringify(await providerResponse.json());
  expect(providerBody).toContain('"provider":"fake"');
  expect(providerBody).not.toMatch(
    /accessToken|refreshToken|encryptedCredentials|ciphertext|authTag/,
  );
  await page.screenshot({
    fullPage: true,
    path: resolve(artifactDirectory, "provider-001-fake-mobile.png"),
  });

  await page.getByLabel("Titre, artiste ou album").fill("midnight");
  await page.getByRole("button", { name: "Rechercher" }).click();
  await expect(
    page.getByRole("list", { name: "Résultats de recherche" }),
  ).toBeVisible();
  await expect(page.getByText("midnight · Midnight Relay")).toBeVisible();
  await expect(
    page.getByText("fake · lecture disponible").first(),
  ).toBeVisible();
  const searchResponse = await page.request.get(
    `/api/lobbies/${lobbyId}/search?q=midnight&limit=2`,
  );
  expect(searchResponse.ok()).toBe(true);
  const searchBody = JSON.stringify(await searchResponse.json());
  expect(searchBody).toContain(`"connectionId":"fake:${lobbyId}"`);
  expect(searchBody).not.toMatch(
    /accessToken|refreshToken|encryptedCredentials|ciphertext|authTag/,
  );
  const idempotencySearch = await page.request.get(
    `/api/lobbies/${lobbyId}/search?q=idempotence&limit=1`,
  );
  const idempotencyTrack = (
    (await idempotencySearch.json()) as { results: CatalogTrack[] }
  ).results[0]!;
  const duplicateCommandId = randomUUID();
  const addedOnce = await page.request.post(
    `/api/lobbies/${lobbyId}/queue/items`,
    { data: { commandId: duplicateCommandId, track: idempotencyTrack } },
  );
  const addedTwice = await page.request.post(
    `/api/lobbies/${lobbyId}/queue/items`,
    { data: { commandId: duplicateCommandId, track: idempotencyTrack } },
  );
  expect(addedOnce.status()).toBe(201);
  expect(addedTwice.status()).toBe(201);
  const firstMutation = (await addedOnce.json()) as QueueMutation;
  const replayedMutation = (await addedTwice.json()) as QueueMutation;
  expect(firstMutation.replayed).toBe(false);
  expect(replayedMutation.replayed).toBe(true);
  expect(replayedMutation.snapshot.items).toHaveLength(1);
  const cleanupMutation = await page.request.delete(
    `/api/lobbies/${lobbyId}/queue/items/${firstMutation.snapshot.items[0]!.id}`,
    {
      data: {
        commandId: randomUUID(),
        expectedVersion: replayedMutation.snapshot.version,
      },
    },
  );
  expect(cleanupMutation.ok()).toBe(true);
  await page.screenshot({
    fullPage: true,
    path: resolve(artifactDirectory, "search-001-results-mobile.png"),
  });

  await page.route(`**/api/lobbies/${lobbyId}/search?*`, (route) =>
    route.fulfill({
      body: JSON.stringify({
        cursors: [],
        issues: [
          {
            code: "SIMULATED_PARTIAL_FAILURE",
            connectionId: `fake:${lobbyId}`,
            message: "One simulated catalog shard did not answer",
            provider: "fake",
            retryable: true,
            type: "provider",
          },
        ],
        results: [
          {
            album: "Shared Signals",
            artists: ["Static Friends"],
            durationMs: 205000,
            explicit: false,
            id: "partial-result",
            imageUrl: null,
            isrc: "FAKE00000002",
            title: "Partial but useful",
            variants: [
              {
                connectionId: `fake:${lobbyId}`,
                playbackAvailability: "playable",
                provider: "fake",
                providerTrackId: "fake:partial",
              },
            ],
          },
        ],
      }),
      contentType: "application/json",
      status: 200,
    }),
  );
  await page.getByLabel("Titre, artiste ou album").fill("partial");
  await page.getByRole("button", { name: "Rechercher" }).click();
  await expect(page.getByText("Partial but useful")).toBeVisible();
  await expect(
    page.getByText("Certains catalogues n’ont pas répondu complètement."),
  ).toBeVisible();
  await page.screenshot({
    fullPage: true,
    path: resolve(artifactDirectory, "search-001-partial-mobile.png"),
  });
  await page.unroute(`**/api/lobbies/${lobbyId}/search?*`);

  const guestContext = await browser.newContext({
    viewport: { height: 844, width: 390 },
  });
  const guestPage = await guestContext.newPage();
  guestPage.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  await guestPage.goto(inviteUrl);
  await expect(guestPage.getByLabel("Code à 6 caractères")).toHaveValue(code);
  await guestPage
    .locator(".entry-card:not(.entry-card--primary)")
    .getByLabel("Votre pseudonyme")
    .fill("Noor");
  await guestPage.getByRole("button", { name: "Rejoindre le lobby" }).click();
  await expect(guestPage.getByText("Noor · 2 membres")).toBeVisible();

  await guestPage.reload();
  await expect(guestPage.getByText("Noor · 2 membres")).toBeVisible();
  await expect(guestPage.getByText("Temps réel connecté")).toBeVisible();
  await expect(page.getByText("Temps réel connecté")).toBeVisible();

  await page.getByLabel("Titre, artiste ou album").fill("midnight");
  await page.getByRole("button", { name: "Rechercher" }).click();
  await page.getByRole("button", { name: "Ajouter à la file" }).first().click();
  await expect(page.locator(".queue-add-feedback")).toContainText(
    "midnight · Midnight Relay ajouté à la file",
  );
  await expect(page.getByRole("button", { name: "Ajouté ✓" })).toBeVisible();
  await page.screenshot({
    fullPage: true,
    path: resolve(artifactDirectory, "ux-001-lobby-mobile.png"),
  });
  await expect(
    guestPage.getByRole("list", { name: "File musicale" }),
  ).toContainText("midnight · Midnight Relay");

  await guestPage.getByLabel("Titre, artiste ou album").fill("signal");
  await guestPage.getByRole("button", { name: "Rechercher" }).click();
  await guestPage
    .getByRole("button", { name: "Ajouter à la file" })
    .first()
    .click();
  await expect(page.getByRole("list", { name: "File musicale" })).toContainText(
    "signal · Midnight Relay",
  );

  await guestPage
    .getByRole("button", { name: "Monter signal · Midnight Relay" })
    .click();
  await expect(
    page.getByRole("list", { name: "File musicale" }).locator("li").first(),
  ).toContainText("signal · Midnight Relay");

  const beforeConcurrentReorder = (await (
    await page.request.get(`/api/lobbies/${lobbyId}/queue`)
  ).json()) as QueueSnapshotPayload;
  const reversedIds = beforeConcurrentReorder.items
    .map(({ id }) => id)
    .reverse();
  const concurrentReorders = await Promise.all([
    page.request.put(`/api/lobbies/${lobbyId}/queue/order`, {
      data: {
        commandId: randomUUID(),
        expectedVersion: beforeConcurrentReorder.version,
        itemIds: reversedIds,
      },
    }),
    page.request.put(`/api/lobbies/${lobbyId}/queue/order`, {
      data: {
        commandId: randomUUID(),
        expectedVersion: beforeConcurrentReorder.version,
        itemIds: reversedIds,
      },
    }),
  ]);
  expect(
    concurrentReorders.map((response) => response.status()).sort(),
  ).toEqual([200, 409]);
  const conflictResponse = concurrentReorders.find(
    (response) => response.status() === 409,
  )!;
  expect(await conflictResponse.json()).toMatchObject({
    code: "QUEUE_VERSION_CONFLICT",
    snapshot: { version: beforeConcurrentReorder.version + 1 },
  });
  await expect(
    guestPage
      .getByRole("list", { name: "File musicale" })
      .locator("li")
      .first(),
  ).toContainText("midnight · Midnight Relay");
  await guestPage
    .getByRole("button", { name: "Monter signal · Midnight Relay" })
    .click();
  await expect(
    page.getByRole("list", { name: "File musicale" }).locator("li").first(),
  ).toContainText("signal · Midnight Relay");

  await page
    .getByRole("button", { name: "Retirer midnight · Midnight Relay" })
    .click();
  await expect(
    guestPage.getByRole("list", { name: "File musicale" }),
  ).not.toContainText("midnight · Midnight Relay");

  await guestContext.setOffline(true);
  await expect(guestPage.getByText("Temps réel dégradé")).toBeVisible();
  await page.getByLabel("Titre, artiste ou album").fill("reconnexion");
  await page.getByRole("button", { name: "Rechercher" }).click();
  const reconnectResult = page.locator(".search-results > li").first();
  await expect(reconnectResult).toContainText("reconnexion");
  const reconnectTitle = (
    await reconnectResult.locator("strong").innerText()
  ).trim();
  await reconnectResult
    .getByRole("button", { name: "Ajouter à la file" })
    .click();
  await guestContext.setOffline(false);
  await expect(guestPage.getByText("Temps réel connecté")).toBeVisible();
  await expect(
    guestPage.getByRole("list", { name: "File musicale" }),
  ).toContainText(reconnectTitle);

  await guestPage.reload();
  await expect(
    guestPage.getByRole("list", { name: "File musicale" }),
  ).toContainText("signal · Midnight Relay");
  await expect(
    guestPage.getByRole("list", { name: "File musicale" }),
  ).toContainText(reconnectTitle);
  await guestPage.screenshot({
    fullPage: true,
    path: resolve(artifactDirectory, "queue-001-collaborative-mobile.png"),
  });

  const observerContext = await browser.newContext({
    viewport: { height: 844, width: 390 },
  });
  const observerPage = await observerContext.newPage();
  observerPage.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  await observerPage.goto(inviteUrl);
  await observerPage
    .locator(".entry-card:not(.entry-card--primary)")
    .getByLabel("Votre pseudonyme")
    .fill("Alex");
  await observerPage
    .getByRole("button", { name: "Rejoindre le lobby" })
    .click();
  await expect(observerPage.getByText("Alex · 3 membres")).toBeVisible();
  await expect(
    observerPage.getByRole("list", { name: "File musicale" }).locator("li"),
  ).toHaveCount(2);
  await expect(
    observerPage.getByRole("list", { name: "File musicale" }),
  ).toContainText(reconnectTitle);

  await page.getByRole("button", { name: "Devenir le lecteur" }).click();
  await expect(page.getByText("Cet appareil diffuse")).toBeVisible();
  await expect(observerPage.getByText("Diffusé par Camille")).toBeVisible();
  const observerDeviceId = await observerPage.evaluate(() =>
    window.sessionStorage.getItem("easyplaylist.playerDeviceId"),
  );
  const competingClaim = await observerPage.request.post(
    `/api/lobbies/${lobbyId}/player/claim`,
    {
      data: { commandId: randomUUID(), deviceId: observerDeviceId },
    },
  );
  expect(competingClaim.status()).toBe(409);
  expect(await competingClaim.json()).toMatchObject({ code: "LEASE_HELD" });
  await expect(
    observerPage.getByRole("button", { name: "Simuler la fin" }),
  ).toHaveCount(0);

  await guestPage.getByRole("button", { name: "Démarrer la file" }).click();
  await expect(
    page.locator(".now-playing").getByText("signal · Midnight Relay"),
  ).toBeVisible();
  await expect(
    observerPage.locator(".now-playing").getByText("signal · Midnight Relay"),
  ).toBeVisible();
  await expect(
    observerPage.getByLabel("Simulation du lecteur fake"),
  ).toHaveCount(0);

  const sameBrowserPage = await page.context().newPage();
  sameBrowserPage.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  await sameBrowserPage.goto(`/lobbies/${lobbyId}`);
  await expect(sameBrowserPage.getByText("Camille · 3 membres")).toBeVisible();
  await expect(sameBrowserPage.getByText("Diffusé par Camille")).toBeVisible();
  await expect(sameBrowserPage.getByText("Cet appareil diffuse")).toHaveCount(
    0,
  );
  await expect(
    sameBrowserPage.getByLabel("Simulation du lecteur fake"),
  ).toHaveCount(0);
  const [playerDeviceId, sameBrowserDeviceId] = await Promise.all([
    page.evaluate(() =>
      window.sessionStorage.getItem("easyplaylist.playerDeviceId"),
    ),
    sameBrowserPage.evaluate(() =>
      window.sessionStorage.getItem("easyplaylist.playerDeviceId"),
    ),
  ]);
  expect(playerDeviceId).not.toBe(sameBrowserDeviceId);
  await sameBrowserPage.screenshot({
    fullPage: true,
    path: resolve(
      artifactDirectory,
      "player-002-silent-second-tab-mobile.png",
    ),
  });
  await sameBrowserPage.close();

  await page.screenshot({
    fullPage: true,
    path: resolve(artifactDirectory, "player-001-playing-mobile.png"),
  });

  await page.getByRole("button", { name: "Simuler la fin" }).click();
  await expect(
    page.getByText("Titre terminé : signal · Midnight Relay"),
  ).toBeVisible();
  await expect(page.getByText(reconnectTitle).first()).toBeVisible();
  await page.getByRole("button", { name: "Simuler un échec" }).click();
  await expect(
    observerPage.getByText(
      `Titre en échec, file poursuivie : ${reconnectTitle}`,
    ),
  ).toBeVisible();
  await expect(observerPage.getByText("Aucun titre en lecture.")).toBeVisible();

  await page.reload();
  await expect(page.getByText("Camille · 3 membres")).toBeVisible();
  await page.setViewportSize({ height: 900, width: 1280 });
  await page.screenshot({
    fullPage: true,
    path: resolve(artifactDirectory, "ux-001-lobby-desktop.png"),
  });

  const invalidContext = await browser.newContext({
    viewport: { height: 844, width: 390 },
  });
  const invalidPage = await invalidContext.newPage();
  await invalidPage.goto("/");
  await expect(invalidPage.getByRole("status")).toHaveText("Service prêt");
  const forbiddenProviderResponse = await invalidPage.request.get(
    `/api/lobbies/${lobbyId}/providers`,
  );
  expect(forbiddenProviderResponse.status()).toBe(404);
  expect(await forbiddenProviderResponse.json()).toEqual({
    code: "LOBBY_NOT_FOUND",
    message: "This lobby is not available",
  });
  const forbiddenQueueResponse = await invalidPage.request.get(
    `/api/lobbies/${lobbyId}/queue`,
  );
  expect(forbiddenQueueResponse.status()).toBe(404);
  expect(await forbiddenQueueResponse.json()).toEqual({
    code: "LOBBY_NOT_FOUND",
    message: "This lobby is not available",
  });
  await invalidPage.getByLabel("Code à 6 caractères").fill("ZZZZZZ");
  await invalidPage
    .locator(".entry-card:not(.entry-card--primary)")
    .getByLabel("Votre pseudonyme")
    .fill("Alex");
  await invalidPage.getByRole("button", { name: "Rejoindre le lobby" }).click();
  await expect(invalidPage.getByRole("alert")).toContainText(
    "Ce code n’est plus disponible",
  );

  for (const inspectedPage of [page, guestPage, observerPage, invalidPage]) {
    const dimensions = await inspectedPage.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBe(dimensions.clientWidth);
  }

  const forbiddenClose = await guestPage.request.delete(
    `/api/lobbies/${lobbyId}`,
  );
  expect(forbiddenClose.status()).toBe(403);
  expect(await forbiddenClose.json()).toEqual({
    code: "LOBBY_CREATOR_REQUIRED",
    message: "Only the lobby creator can close it",
  });

  const creatorContext = page.context();
  await page.close();
  await expect(observerPage.getByText("Lecteur disponible")).toBeVisible({
    timeout: 10_000,
  });
  await observerPage
    .getByRole("button", { name: "Devenir le lecteur" })
    .click();
  await expect(observerPage.getByText("Cet appareil diffuse")).toBeVisible();
  await observerPage.screenshot({
    fullPage: true,
    path: resolve(artifactDirectory, "player-001-lease-recovery-mobile.png"),
  });

  const creatorReturnPage = await creatorContext.newPage();
  await creatorReturnPage.setViewportSize({ height: 844, width: 390 });
  creatorReturnPage.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  await creatorReturnPage.goto(`/lobbies/${lobbyId}`);
  await expect(
    creatorReturnPage.getByRole("button", { name: "Fermer le lobby" }),
  ).toBeHidden();
  await creatorReturnPage.locator(".lobby-settings > summary").click();
  await expect(
    creatorReturnPage.getByRole("button", { name: "Fermer le lobby" }),
  ).toBeVisible();
  creatorReturnPage.once("dialog", (dialog) => dialog.accept());
  await creatorReturnPage
    .getByRole("button", { name: "Fermer le lobby" })
    .click();
  await expect(
    creatorReturnPage.getByRole("heading", {
      level: 1,
      name: "La soirée est terminée.",
    }),
  ).toBeVisible();
  await expect(
    observerPage.getByRole("heading", {
      level: 1,
      name: "La soirée est terminée.",
    }),
  ).toBeVisible();
  const actionAfterClose = await guestPage.request.post(
    `/api/lobbies/${lobbyId}/queue/items`,
    { data: { commandId: randomUUID(), track: idempotencyTrack } },
  );
  expect(actionAfterClose.status()).toBe(404);
  await creatorReturnPage.screenshot({
    fullPage: true,
    path: resolve(artifactDirectory, "lobby-002-closed-mobile.png"),
  });
  expect(
    consoleErrors.filter(
      (message) => !message.includes("ERR_INTERNET_DISCONNECTED"),
    ),
  ).toEqual([]);

  await creatorReturnPage.close();
  await guestContext.close();
  await observerContext.close();
  await invalidContext.close();
});

interface CatalogTrack {
  album: string;
  artists: string[];
  durationMs: number;
  explicit: boolean;
  id: string;
  imageUrl: string | null;
  isrc: string | null;
  title: string;
  variants: Array<{
    connectionId: string;
    playbackAvailability: "playable" | "unavailable" | "unknown";
    provider: string;
    providerTrackId: string;
  }>;
}

interface QueueSnapshotPayload {
  items: Array<{ id: string }>;
  version: number;
}

interface QueueMutation {
  replayed: boolean;
  snapshot: QueueSnapshotPayload;
}
