import { CustomizationPurchase } from "../../models/CustomizationPurchase.js";
import { escapeRegex } from "../lib/collections.js";
import { publicCustomizationPerson } from "../../utils/contactPrivacy.js";

export async function listPayments({
  page = 1,
  limit = 20,
  q = "",
  paymentStatus = "all",
  fulfillment = "all",
}) {
  const match = {};
  if (paymentStatus !== "all") match.paymentStatus = paymentStatus;
  if (fulfillment !== "all") match.status = fulfillment;
  const pipeline = [
    {
      $addFields: {
        paymentStatus: {
          $ifNull: [
            "$paymentStatus",
            {
              $cond: [{ $eq: ["$status", "fulfilled"] }, "captured", "created"],
            },
          ],
        },
      },
    },
    { $match: match },
    {
      $lookup: {
        from: "users",
        localField: "user",
        foreignField: "_id",
        as: "payer",
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "recipient",
        foreignField: "_id",
        as: "recipientUser",
      },
    },
  ];
  if (q) {
    const pattern = new RegExp(escapeRegex(q), "i");
    pipeline.push({
      $match: {
        $or: [
          { orderId: pattern },
          { paymentId: pattern },
          { lastPaymentId: pattern },
          { "config.title": pattern },
          { "payer.name": pattern },
          { "payer.email": pattern },
          { "recipientUser.name": pattern },
          { "recipientUser.email": pattern },
        ],
      },
    });
  }
  pipeline.push({
    $facet: {
      items: [
        { $sort: { createdAt: -1, _id: -1 } },
        { $skip: (page - 1) * limit },
        { $limit: limit },
        {
          $project: {
            user: 1,
            recipient: 1,
            amount: 1,
            currency: 1,
            status: 1,
            paymentStatus: 1,
            orderId: 1,
            paymentId: 1,
            lastPaymentId: 1,
            createdAt: 1,
            fulfilledAt: 1,
            lastCheckedAt: 1,
            capturedAt: 1,
            amountRefunded: 1,
            failureCode: 1,
            "config.title": 1,
            payer: {
              $map: {
                input: "$payer",
                as: "u",
                in: {
                  _id: "$$u._id",
                  name: "$$u.name",
                  email: "$$u.email",
                  phone: "$$u.phone",
                },
              },
            },
            recipientUser: {
              $map: {
                input: "$recipientUser",
                as: "u",
                in: {
                  _id: "$$u._id",
                  name: "$$u.name",
                  email: "$$u.email",
                  phone: "$$u.phone",
                },
              },
            },
          },
        },
      ],
      summary: [
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            fulfilled: {
              $sum: { $cond: [{ $eq: ["$status", "fulfilled"] }, 1, 0] },
            },
            pending: {
              $sum: { $cond: [{ $ne: ["$status", "fulfilled"] }, 1, 0] },
            },
            failed: {
              $sum: {
                $cond: [
                  { $in: ["$paymentStatus", ["failed", "order_failed"]] },
                  1,
                  0,
                ],
              },
            },
            gross: {
              $sum: {
                $ifNull: [
                  "$capturedAmount",
                  { $cond: [{ $eq: ["$status", "fulfilled"] }, "$amount", 0] },
                ],
              },
            },
            refunded: { $sum: { $ifNull: ["$amountRefunded", 0] } },
          },
        },
      ],
    },
  });
  const [result] = await CustomizationPurchase.aggregate(pipeline);
  const stats = {
    total: 0,
    fulfilled: 0,
    pending: 0,
    failed: 0,
    gross: 0,
    refunded: 0,
    ...result?.summary?.[0],
  };
  delete stats._id;
  stats.net = Math.max(0, stats.gross - stats.refunded);
  const items = (result?.items ?? []).map((p) => ({
    id: String(p._id),
    title: p.config?.title ?? "Customization",
    payer: p.payer?.[0] ? publicCustomizationPerson(p.payer[0]) : null,
    recipient: p.recipientUser?.[0]
      ? publicCustomizationPerson(p.recipientUser[0])
      : null,
    amount: p.amount,
    currency: p.currency,
    paymentStatus: p.paymentStatus,
    fulfillmentStatus: p.status,
    orderId: p.orderId ?? null,
    paymentId: p.paymentId ?? p.lastPaymentId ?? null,
    createdAt: p.createdAt,
    fulfilledAt: p.fulfilledAt ?? null,
    lastCheckedAt: p.lastCheckedAt ?? null,
    capturedAt: p.capturedAt ?? null,
    amountRefunded: p.amountRefunded ?? 0,
    failureCode: p.failureCode ?? null,
  }));
  return {
    items,
    stats,
    total: stats.total,
    page,
    pages: Math.max(1, Math.ceil(stats.total / limit)),
    limit,
  };
}
