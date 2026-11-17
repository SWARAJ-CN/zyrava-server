import { AppearanceSettings } from "../models/AppearanceSettings.js";

// This setting controls presentation only. Account restrictions remain in
// accountExperience and must never depend on this switch.
export async function readAppearance() {
  const record = await AppearanceSettings.findById("appearance").lean();
  return {
    vimithaThemeEnabled: record?.vimithaThemeEnabled ?? true,
    updatedAt: record?.updatedAt ?? null,
    updatedBy: record?.updatedBy ?? null,
  };
}

export async function updateAppearance(vimithaThemeEnabled, adminEmail) {
  const record = await AppearanceSettings.findOneAndUpdate(
    { _id: "appearance" },
    { $set: { vimithaThemeEnabled, updatedBy: adminEmail } },
    { upsert: true, new: true, runValidators: true },
  ).lean();
  return {
    vimithaThemeEnabled: record.vimithaThemeEnabled,
    updatedAt: record.updatedAt,
    updatedBy: record.updatedBy,
  };
}
