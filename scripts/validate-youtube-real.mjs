import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { chromium, expect } from "@playwright/test";

const baseUrl =
  process.env.YOUTUBE_VALIDATION_BASE_URL ?? "http://127.0.0.1:5173";
const headed = process.env.YOUTUBE_VALIDATION_HEADED !== "false";
const artifactPath = resolve(
  "artifacts/validation/provider-003-youtube-real-player.png",
);

await mkdir(resolve("artifacts/validation"), { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: !headed });
const context = await browser.newContext({
  viewport: { height: 900, width: 1280 },
});
const page = await context.newPage();
const parentConsoleErrors = [];
const youtubeWarnings = [];

page.on("console", (message) => {
  if (
    message.type() === "error" &&
    message.location().url.startsWith(baseUrl)
  ) {
    parentConsoleErrors.push(message.text());
  }

  if (
    message.type() === "warning" &&
    message.text().includes("YouTube IFrame player error")
  ) {
    youtubeWarnings.push(message.text());
  }
});

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByLabel("Nom de la soirée").fill("Validation YouTube réelle");
  await page
    .locator(".entry-card--primary")
    .getByLabel("Votre pseudonyme")
    .fill("Lecteur de validation");
  await page.getByRole("button", { name: "Créer et inviter" }).click();

  await expect(page.getByText("Source musicale")).toHaveCount(0);
  await expect(page.getByText("Mode démo")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Lecteur de la soirée" }),
  ).toBeVisible();

  await page
    .getByLabel("Titre, artiste ou album")
    .fill("NoCopyrightSounds music");
  await page.getByRole("button", { name: "Rechercher" }).click();
  const results = page.locator(".search-results > li");
  const selectedTitles = [];
  await expect(results.first()).toBeVisible({ timeout: 15_000 });

  for (let index = 0; index < Math.min(await results.count(), 5); index += 1) {
    const result = results.nth(index);
    await expect(result).toContainText("youtube · lecture disponible");
    const title = (await result.locator("strong").innerText()).trim();
    selectedTitles.push(title);
    await result.getByRole("button", { name: "Ajouter à la file" }).click();
    await expect(page.locator(".queue-list")).toContainText(title);
  }

  await page.getByRole("button", { name: "Devenir le lecteur" }).click();
  await expect(page.getByText("Cet appareil diffuse")).toBeVisible();
  await page.getByRole("button", { name: "Démarrer la file" }).click();

  const iframe = page.locator(
    '.youtube-player iframe[src*="youtube.com/embed"]',
  );
  const youtubeFrame = page.frameLocator(
    '.youtube-player iframe[src*="youtube.com/embed"]',
  );
  const video = youtubeFrame.locator("video");
  const activateButton = page.getByRole("button", {
    name: "Activer la lecture",
  });

  const playbackDeadline = Date.now() + 75_000;
  const attemptedTitles = new Set();
  let before;
  let playing;
  let playingTitle;

  while (Date.now() < playbackDeadline) {
    if (youtubeWarnings.length >= selectedTitles.length) {
      break;
    }

    const currentTitle = await page
      .locator(".now-playing strong")
      .textContent({ timeout: 1_000 })
      .catch(() => null);

    if (currentTitle) {
      attemptedTitles.add(currentTitle.trim());
    }

    if (await activateButton.isVisible().catch(() => false)) {
      await activateButton.click();
    }

    if (await iframe.isVisible().catch(() => false)) {
      const candidateBefore = await readVideoState(video, 1_000).catch(
        () => null,
      );

      if (candidateBefore?.readyState >= 2) {
        await page.waitForTimeout(3_000);
        const candidatePlaying = await readVideoState(video, 1_000).catch(
          () => null,
        );

        if (
          candidatePlaying &&
          !candidatePlaying.paused &&
          candidatePlaying.currentTime > candidateBefore.currentTime + 0.5
        ) {
          before = candidateBefore;
          playing = candidatePlaying;
          playingTitle = currentTitle?.trim() ?? "unknown";
          break;
        }
      }
    }

    await page.waitForTimeout(500);
  }

  if (!before || !playing || !playingTitle) {
    const transition = await page
      .locator(".player-transition")
      .textContent()
      .catch(() => null);
    throw new Error(
      `No queued YouTube video started. Attempted=${JSON.stringify([...attemptedTitles])}, transition=${transition}`,
    );
  }

  if (playing.muted || playing.volume <= 0) {
    throw new Error(
      `YouTube playback is silent: muted=${playing.muted}, volume=${playing.volume}`,
    );
  }

  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect
    .poll(async () => (await readVideoState(video)).paused, { timeout: 10_000 })
    .toBe(true);
  await page.getByRole("button", { name: "Reprendre" }).click();
  const resumedAt = (await readVideoState(video)).currentTime;
  await expect
    .poll(async () => (await readVideoState(video)).currentTime, {
      timeout: 10_000,
    })
    .toBeGreaterThan(resumedAt + 0.5);

  await page.screenshot({ fullPage: true, path: artifactPath });

  const proof = {
    consoleErrors: parentConsoleErrors,
    duration: playing.duration,
    muted: playing.muted,
    paused: playing.paused,
    playingTitle,
    queuedTitles: selectedTitles,
    screenshot: artifactPath,
    attemptedTitles: [...attemptedTitles],
    timeAdvancedSeconds: Number(
      (playing.currentTime - before.currentTime).toFixed(2),
    ),
    volume: playing.volume,
    youtubeWarnings,
  };
  process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);

  if (parentConsoleErrors.length > 0) {
    throw new Error("The EasyPlaylist page emitted console errors");
  }
} catch (error) {
  const failurePath = resolve(
    "artifacts/validation/provider-003-youtube-real-failure.png",
  );
  await page.screenshot({ fullPage: true, path: failurePath });
  process.stderr.write(
    `${JSON.stringify({ failureScreenshot: failurePath, parentConsoleErrors, youtubeWarnings }, null, 2)}\n`,
  );
  throw error;
} finally {
  await context.close();
  await browser.close();
}

async function readVideoState(locator, timeout = 30_000) {
  return locator.evaluate(
    (element) => ({
      currentTime: element.currentTime,
      duration: element.duration,
      muted: element.muted,
      paused: element.paused,
      readyState: element.readyState,
      volume: element.volume,
    }),
    undefined,
    { timeout },
  );
}
