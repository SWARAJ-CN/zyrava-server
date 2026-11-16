import { User } from "../../src/models/User.js";
import { Customization } from "../../src/models/Customization.js";
import { PERSONAL_ACCOUNT_EMAIL } from "../../src/services/accountExperience.js";
const a = "000000000000000000000001",
  b = "000000000000000000000002",
  privateId = "000000000000000000000003";
function matches(row, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === "$or") return value.some((item) => matches(row, item));
    const actual = key.split(".").reduce((value, part) => value?.[part], row);
    if (value instanceof RegExp) return value.test(actual ?? "");
    if (value instanceof Date) return +new Date(actual) === +value;
    if (value && typeof value === "object" && "$ne" in value)
      return String(actual) !== String(value.$ne);
    return String(actual) === String(value);
  });
}
export function database(t) {
  const users = [
    {
      _id: a,
      name: "Creator",
      email: "creator@example.com",
      customization: null,
    },
    {
      _id: b,
      name: "Recipient",
      email: "recipient@example.com",
      phone: "+919876543210",
      customization: null,
    },
    {
      _id: privateId,
      name: "Vimitha",
      email: PERSONAL_ACCOUNT_EMAIL,
      customization: null,
    },
  ];
  const designs = [];
  function query(raw) {
    let populate = false;
    return {
      session() {
        return this;
      },
      select() {
        return this;
      },
      sort() {
        return this;
      },
      limit() {
        return this;
      },
      populate() {
        populate = true;
        return this;
      },
      lean() {
        return Promise.resolve(this.result());
      },
      result() {
        const value = structuredClone(raw);
        if (!populate) return value;
        return value.map((d) => ({
          ...d,
          creator: users.find((u) => u._id === d.creator),
          recipient: users.find((u) => u._id === d.recipient),
        }));
      },
      then(resolve, reject) {
        return Promise.resolve(this.result()).then(resolve, reject);
      },
    };
  }
  t.mock.method(User, "findById", (id) =>
    query(users.find((u) => u._id === String(id)) ?? null),
  );
  t.mock.method(User, "find", (filter) =>
    query(users.filter((u) => matches(u, filter))),
  );
  t.mock.method(User, "updateOne", async (filter, update) => {
    const user = users.find((u) => matches(u, filter));
    if (!user) return { modifiedCount: 0 };
    if (update.$set) Object.assign(user, structuredClone(update.$set));
    for (const key of Object.keys(update.$unset ?? {})) delete user[key];
    return { modifiedCount: 1 };
  });
  t.mock.method(Customization, "find", (filter) =>
    query(designs.filter((d) => matches(d, filter))),
  );
  t.mock.method(Customization, "findOne", (filter) =>
    query(designs.find((d) => matches(d, filter)) ?? null),
  );
  t.mock.method(Customization, "findOneAndUpdate", async (filter, update) => {
    let d = designs.find((d) => matches(d, filter));
    if (!d) {
      d = { _id: String(10 + designs.length).padStart(24, "0"), ...filter };
      designs.push(d);
    }
    Object.assign(d, structuredClone(update.$set), { updatedAt: new Date() });
    return structuredClone(d);
  });
  t.mock.method(Customization, "updateOne", async (filter, update) => {
    const d = designs.find((d) => matches(d, filter));
    if (d) Object.assign(d, update.$set);
    return { modifiedCount: d ? 1 : 0 };
  });
  return { users, designs, query, matches };
}
