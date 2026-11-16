import { CustomizationPurchase } from "../models/CustomizationPurchase.js";
import { publicCustomizationPerson } from "../utils/contactPrivacy.js";

/** The caller supplies the authenticated account ID (or an admin-selected user).
 * Never serialize the purchase document directly: credential versions and keys
 * belong only to the checkout service. */
export async function readPaymentHistory(
  userId,
  { page = 1, limit = 10 } = {},
) {
  const filter = { user: userId };
  const [total, rows] = await Promise.all([
    CustomizationPurchase.countDocuments(filter),
    CustomizationPurchase.find(filter)
      .select(
        "recipient purpose config.title config.durationMinutes amount currency paymentStatus status orderId paymentId lastPaymentId amountRefunded createdAt fulfilledAt lastCheckedAt",
      )
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("recipient", "name email phone")
      .lean(),
  ]);
  return {
    items: rows.map((p) => {
      const recipient =
        p.recipient && typeof p.recipient === "object" && p.recipient._id
          ? publicCustomizationPerson(p.recipient)
          : null;
      const purpose =
        p.purpose ??
        (recipient?.id === String(userId)
          ? "customization_self"
          : "customization_gift");
      return {
        id: String(p._id),
        title: p.config?.title ?? "Customization",
        purpose,
        recipient,
        amount: p.amount,
        currency: p.currency,
        amountRefunded: p.amountRefunded ?? 0,
        paymentStatus:
          p.paymentStatus ??
          (p.status === "fulfilled" ? "captured" : "created"),
        fulfillmentStatus: p.status,
        orderId: p.orderId ?? null,
        paymentId: p.paymentId ?? p.lastPaymentId ?? null,
        durationMinutes: p.config?.durationMinutes ?? null,
        createdAt: p.createdAt,
        fulfilledAt: p.fulfilledAt ?? null,
        lastCheckedAt: p.lastCheckedAt ?? null,
      };
    }),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    limit,
  };
}
