import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import { maskEmail, maskPhone } from "../src/utils/contactPrivacy.js";
import { database } from "./helpers/customizationDatabase.js";
import { publicCustomization } from "../src/models/customizationFields.js";
import { PERSONAL_ACCOUNT_EMAIL } from "../src/services/accountExperience.js";
import * as service from "../src/services/customizationService.js";
import {
  customizationConfig,
  saveCustomizationSchema,
} from "../src/validators/customization.js";
import { customizationRoutes } from "../src/routes/customizationRoutes.js";
import { signAccessToken } from "../src/utils/tokens.js";

const a = "000000000000000000000001",
  b = "000000000000000000000002",
  privateId = "000000000000000000000003";
const config = {
  title: "Made for you",
  accent: "#ed70aa",
  background: "#20141c",
  surface: "#32212c",
  text: "#fff4fa",
  loadingAnimation: "couples-1",
  headerAnimation: "couples-2",
  lyricsAnimation: "couples-3",
  loadingMessage: "A little moment, your music is coming.",
};

test("customization validates colors, lengths, asset allowlist and rejects spoofed creator fields", () => {
  assert.equal(customizationConfig.safeParse(config).success, true);
  for (const changed of [
    { accent: "red; background:url(x)" },
    { headerAnimation: "https://example.com/a.lottie" },
    { loadingMessage: "x".repeat(141) },
    { title: "" },
    { loadingMessage: "hello\u0000" },
  ])
    assert.equal(
      customizationConfig.safeParse({ ...config, ...changed }).success,
      false,
    );
  assert.equal(
    saveCustomizationSchema.safeParse({
      body: { recipientId: b, config, creator: { id: privateId } },
      query: {},
      params: {},
    }).success,
    false,
  );
});
test("recipient search hides reserved account, treats regex metacharacters literally and exposes no phone/password", async (t) => {
  database(t);
  assert.deepEqual(await service.searchRecipients(a, "Vimitha"), []);
  assert.deepEqual(
    await service.searchRecipients(a, PERSONAL_ACCOUNT_EMAIL),
    [],
  );
  assert.deepEqual(await service.searchRecipients(a, "rec.*"), []);
  const results = await service.searchRecipients(a, "recipient@");
  assert.deepEqual(results, [
    {
      id: b,
      name: "Recipient",
      email: "re***t@example.com",
      phone: "•••• 210",
    },
  ]);
});
test("reserved account cannot create, receive, reset, or read customization", async (t) => {
  database(t);
  for (const call of [
    () => service.readCustomizations(privateId),
    () => service.searchRecipients(privateId, "creator"),
    () => service.saveCustomization(privateId, { recipientId: b, config }),
    () => service.resetCustomization(privateId),
  ])
    await assert.rejects(call, { status: 403 });
  await assert.rejects(
    service.saveCustomization(a, { recipientId: privateId, config }),
    { status: 404 },
  );
});
test("self customization applies immediately with server-derived creator attribution and reset restores default", async (t) => {
  const { users } = database(t);
  const saved = await service.saveCustomization(a, { recipientId: a, config });
  assert.deepEqual(saved.active.creator, {
    id: a,
    name: "Creator",
    email: "cr***r@example.com",
    phone: null,
  });
  assert.equal(saved.active.config.accent, config.accent);
  assert.equal(users[1].customization, null);
  assert.equal((await service.resetCustomization(a)).active, null);
});
test("recipient owns acceptance; pending edits cannot replace an accepted snapshot", async (t) => {
  const { users } = database(t);
  const sent = await service.saveCustomization(a, { recipientId: b, config });
  assert.equal(sent.active, null);
  assert.equal(users[1].customization, null);
  let inbox = await service.readCustomizations(b);
  assert.equal(inbox.incoming.length, 1);
  assert.equal(inbox.incoming[0].creator.email, "cr***r@example.com");
  const id = inbox.incoming[0].id;
  await assert.rejects(
    service.respondCustomization(b, id, true, "2000-01-01T00:00:00.000Z"),
    { status: 409 },
  );
  await assert.rejects(service.respondCustomization(a, id, true), {
    status: 404,
  });
  const accepted = await service.respondCustomization(
    b,
    id,
    true,
    inbox.incoming[0].updatedAt.toISOString(),
  );
  assert.equal(accepted.active.config.title, config.title);
  assert.equal(accepted.incoming.length, 0);
  await service.saveCustomization(a, {
    recipientId: b,
    config: { ...config, title: "New proposal" },
  });
  inbox = await service.readCustomizations(b);
  assert.equal(inbox.active.config.title, config.title);
  assert.equal(inbox.incoming[0].config.title, "New proposal");
  await service.respondCustomization(
    b,
    id,
    false,
    inbox.incoming[0].updatedAt.toISOString(),
  );
  assert.equal(
    (await service.readCustomizations(b)).active.config.title,
    config.title,
  );
});
test("deleted creators and unrelated recipients cannot be used to apply a design", async (t) => {
  const { users } = database(t);
  await service.saveCustomization(a, { recipientId: b, config });
  const item = (await service.readCustomizations(b)).incoming[0];
  const id = item.id;
  users.splice(0, 1);
  await assert.rejects(
    service.respondCustomization(b, id, true, item.updatedAt.toISOString()),
    { status: 404 },
  );
  assert.equal((await service.readCustomizations(b)).active, null);
});
test("HTTP routes enforce bearer authentication, CSRF, strict validation, and protected-recipient rules", async (t) => {
  database(t);
  const app = express();
  app.use(express.json(), cookieParser());
  app.use("/api/customization", customizationRoutes);
  app.use((err, req, res, next) =>
    res.status(err.status ?? 500).json({ error: err.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/customization`;
  const token = signAccessToken({ _id: a }, true);
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  assert.equal((await fetch(url)).status, 401);
  assert.equal(
    (
      await fetch(url + "/save", {
        method: "POST",
        headers,
        body: JSON.stringify({ recipientId: b, config }),
      })
    ).status,
    403,
  );
  const csrf = "c".repeat(40);
  headers.Cookie = `zyrava_csrf=${csrf}`;
  headers["X-CSRF-Token"] = csrf;
  assert.equal(
    (
      await fetch(url + "/save", {
        method: "POST",
        headers,
        body: JSON.stringify({
          recipientId: b,
          config: { ...config, accent: "no" },
        }),
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await fetch(url + "/save", {
        method: "POST",
        headers,
        body: JSON.stringify({ recipientId: privateId, config }),
      })
    ).status,
    404,
  );
  const response = await fetch(url + "/save", {
    method: "POST",
    headers,
    body: JSON.stringify({ recipientId: a, config }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).active.config.title, config.title);
  const searched = await fetch(url + "/users?q=%2B91%209876543210", {
    headers,
  });
  assert.equal(searched.status, 200);
  const searchBody = await searched.json();
  assert.equal(searchBody.users[0].name, "Recipient");
  assert.equal(searchBody.users[0].email, "re***t@example.com");
  assert.equal(searchBody.users[0].phone, "•••• 210");
  assert.ok(!JSON.stringify(searchBody).includes("recipient@example.com"));
  assert.ok(!JSON.stringify(searchBody).includes("9876543210"));
  assert.equal(
    (
      await fetch(url, {
        headers: {
          Authorization: `Bearer ${signAccessToken({ _id: privateId }, true)}`,
        },
      })
    ).status,
    403,
  );
});

test("duration accepts minutes through 365 days and preserves indefinite legacy designs", () => {
  assert.equal(customizationConfig.parse(config).durationMinutes, null);
  for (const durationMinutes of [null, 1, 60, 1440, 525600])
    assert.equal(
      customizationConfig.safeParse({ ...config, durationMinutes }).success,
      true,
    );
  for (const durationMinutes of [0, -1, 1.5, 525601, "60"])
    assert.equal(
      customizationConfig.safeParse({ ...config, durationMinutes }).success,
      false,
    );
});
test("expiry starts at acceptance, hides expired snapshots, and leaves indefinite themes intact", async (t) => {
  const { users } = database(t);
  await service.saveCustomization(a, {
    recipientId: b,
    config: { ...config, durationMinutes: 60 },
  });
  assert.equal(users[1].customization, null);
  const design = (await service.readCustomizations(b)).incoming[0];
  const result = await service.respondCustomization(
    b,
    design.id,
    true,
    design.updatedAt.toISOString(),
  );
  assert.equal(+result.active.expiresAt - +result.active.appliedAt, 3600000);
  assert.equal(result.received.length, 1);
  const snapshot = users[1].customization;
  assert.ok(publicCustomization(snapshot, +snapshot.expiresAt - 1));
  assert.equal(publicCustomization(snapshot, +snapshot.expiresAt), null);
  snapshot.expiresAt = new Date(0);
  assert.equal((await service.readCustomizations(b)).active, null);
  assert.ok(publicCustomization({ ...snapshot, expiresAt: null }));
  assert.ok(publicCustomization({ ...snapshot, expiresAt: undefined }));
});
test("only recipients can remove gifts, including accepted designs, without clearing another theme", async (t) => {
  database(t);
  await service.saveCustomization(a, { recipientId: b, config });
  const design = (await service.readCustomizations(b)).incoming[0];
  await assert.rejects(service.removeCustomization(a, design.id), {
    status: 404,
  });
  await assert.rejects(service.removeCustomization(privateId, design.id), {
    status: 403,
  });
  await service.respondCustomization(
    b,
    design.id,
    true,
    design.updatedAt.toISOString(),
  );
  let result = await service.removeCustomization(b, design.id);
  assert.equal(result.active, null);
  assert.equal(result.received.length, 0);
  assert.equal(result.incoming.length, 0);
  await service.saveCustomization(a, { recipientId: b, config });
  await service.saveCustomization(b, {
    recipientId: b,
    config: { ...config, title: "My own look" },
  });
  result = await service.removeCustomization(b, design.id);
  assert.equal(result.active.config.title, "My own look");
  assert.equal(result.received.length, 0);
});

test("directory searches email, full username and formatted phone but never exposes raw contacts", async (t) => {
  database(t);
  for (const query of [
    "Recipient",
    "recipient@example.com",
    "+91 (98765) 43210",
    "3210",
  ]) {
    const result = await service.searchRecipients(a, query);
    assert.equal(result.length, 1);
    assert.equal(result[0].name, "Recipient");
    assert.equal(result[0].email, "re***t@example.com");
    assert.equal(result[0].phone, "•••• 210");
    assert.ok(!JSON.stringify(result).includes("recipient@example.com"));
    assert.ok(!JSON.stringify(result).includes("9876543210"));
  }
  const saved = await service.saveCustomization(a, { recipientId: b, config });
  const design = saved.outgoing[0];
  assert.equal(design.recipient.phone, "•••• 210");
  const received = await service.respondCustomization(
    b,
    design.id,
    true,
    design.updatedAt.toISOString(),
  );
  for (const result of [saved, received, await service.readCustomizations(a)]) {
    assert.ok(!JSON.stringify(result).includes("creator@example.com"));
    assert.ok(!JSON.stringify(result).includes("recipient@example.com"));
    assert.ok(!JSON.stringify(result).includes("9876543210"));
  }
});
test("short, missing, and legacy snapshot contacts are masked at the response boundary", () => {
  assert.equal(maskEmail("a@example.com"), "***@example.com");
  assert.equal(maskEmail("ab@example.com"), "a***@example.com");
  assert.equal(maskEmail(null), null);
  assert.equal(maskPhone("+91 98765 43210"), "•••• 210");
  assert.equal(maskPhone("123"), "••••");
  assert.equal(maskPhone(null), null);
  const snapshot = publicCustomization({
    designId: a,
    config,
    creator: {
      id: b,
      name: "Full Username",
      email: "recipient@example.com",
      phone: "+919876543210",
    },
    appliedAt: new Date(),
  });
  assert.equal(snapshot.creator.name, "Full Username");
  assert.equal(snapshot.creator.email, "re***t@example.com");
  assert.equal(snapshot.creator.phone, "•••• 210");
});

test("occasion templates accept all bundled animations, preserve legacy designs and validate wishes", () => {
  assert.equal(customizationConfig.parse(config).template, undefined);
  for (let i = 1; i <= 7; i++) {
    assert.equal(
      customizationConfig.safeParse({
        ...config,
        template: "birthday",
        wishMessage: "Happy birthday!",
        loadingAnimation: `moments-${i}`,
        headerAnimation: `moments-${i}`,
        lyricsAnimation: `moments-${i}`,
      }).success,
      true,
    );
  }
  for (const changed of [
    { template: "unknown" },
    { wishMessage: "x".repeat(281) },
    { wishMessage: "hello\nworld" },
    { loadingAnimation: "moments-8" },
  ]) {
    assert.equal(
      customizationConfig.safeParse({ ...config, ...changed }).success,
      false,
    );
  }
});
