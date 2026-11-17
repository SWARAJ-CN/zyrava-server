import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import { AppearanceSettings } from "../src/models/AppearanceSettings.js";
import {
  readAppearance,
  updateAppearance,
} from "../src/services/appearanceService.js";
import { appearanceRoutes } from "../src/routes/appearanceRoutes.js";
import { adminRoutes } from "../src/admin/routes/index.js";
import { adminEnv } from "../src/admin/env.js";
import { signAccessToken } from "../src/utils/tokens.js";
import { database } from "./helpers/customizationDatabase.js";
import {
  accountExperience,
  assertCommunityUser,
  PERSONAL_ACCOUNT_EMAIL,
} from "../src/services/accountExperience.js";
import { assertCustomizer } from "../src/services/customizationService.js";

function fixture(t) {
  let record = null;
  t.mock.method(AppearanceSettings, "findById", (id) => {
    assert.equal(id, "appearance");
    return { lean: async () => record };
  });
  t.mock.method(
    AppearanceSettings,
    "findOneAndUpdate",
    (filter, update, options) => {
      assert.deepEqual(filter, { _id: "appearance" });
      assert.equal(options.upsert, true);
      assert.equal(options.runValidators, true);
      record = { ...update.$set, updatedAt: new Date() };
      return { lean: async () => record };
    },
  );
}

test("appearance defaults to current theme and stores the administrator's choice separately from restrictions", async (t) => {
  fixture(t);
  database(t);
  assert.equal((await readAppearance()).vimithaThemeEnabled, true);
  for (const enabled of [false, true, false]) {
    await updateAppearance(enabled, "admin@example.com");
    const saved = await readAppearance();
    assert.equal(saved.vimithaThemeEnabled, enabled);
    assert.equal(saved.updatedBy, "admin@example.com");
    assert.equal(
      accountExperience({ email: PERSONAL_ACCOUNT_EMAIL }),
      "brown-burgundy",
    );
    assert.equal(accountExperience({ email: "other@example.com" }), "standard");
    await assert.rejects(assertCommunityUser("000000000000000000000003"), {
      status: 403,
    });
    await assert.rejects(assertCustomizer("000000000000000000000003"), {
      status: 403,
    });
  }
});

test("appearance reads are public without audit details; only administrators can set a strict boolean", async (t) => {
  fixture(t);
  const previous = {
    configured: adminEnv.configured,
    jwtSecret: adminEnv.jwtSecret,
  };
  Object.assign(adminEnv, {
    configured: true,
    jwtSecret: "appearance-test-admin-only-secret",
  });
  t.after(() => Object.assign(adminEnv, previous));
  const app = express();
  app.use(express.json());
  app.use("/api/appearance", appearanceRoutes);
  app.use("/api/admin", adminRoutes);
  app.use((err, req, res, next) =>
    res.status(err.status ?? 500).json({ error: err.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const adminPath = base + "/api/admin/appearance";
  assert.equal((await fetch(adminPath)).status, 401);
  const userHeaders = {
    Authorization: `Bearer ${signAccessToken({ _id: "000000000000000000000003" })}`,
    "Content-Type": "application/json",
  };
  assert.equal(
    (
      await fetch(adminPath, {
        method: "POST",
        headers: userHeaders,
        body: JSON.stringify({ vimithaThemeEnabled: false }),
      })
    ).status,
    401,
  );
  assert.equal((await readAppearance()).vimithaThemeEnabled, true);
  const token = jwt.sign(
    { typ: "admin-access", email: "admin@example.com" },
    adminEnv.jwtSecret,
    { issuer: "zyrava-admin", audience: "zyrava-admin-web", expiresIn: "1m" },
  );
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  for (const body of [
    { vimithaThemeEnabled: "false" },
    { vimithaThemeEnabled: 0 },
    {},
    { vimithaThemeEnabled: false, hiddenMenus: false },
    { vimithaThemeEnabled: false, updatedBy: "spoof@example.com" },
  ]) {
    assert.equal(
      (
        await fetch(adminPath, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        })
      ).status,
      422,
    );
  }
  for (const enabled of [false, true]) {
    const saved = await fetch(adminPath, {
      method: "POST",
      headers,
      body: JSON.stringify({ vimithaThemeEnabled: enabled }),
    });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).updatedBy, "admin@example.com");
    const publicResult = await fetch(base + "/api/appearance");
    assert.equal(publicResult.headers.get("cache-control"), "no-store");
    assert.deepEqual(await publicResult.json(), {
      vimithaThemeEnabled: enabled,
    });
    assert.equal(
      (await (await fetch(adminPath, { headers })).json()).vimithaThemeEnabled,
      enabled,
    );
  }
});
