/** Public account labels. Never send raw contacts in customization responses. */
export function maskEmail(value) {
  if (!value || typeof value !== "string") return null;
  const at = value.lastIndexOf("@");
  if (at < 1) return "***";
  const local = value.slice(0, at);
  const visible =
    local.length > 3
      ? `${local.slice(0, 2)}***${local.slice(-1)}`
      : local.length > 1
        ? `${local[0]}***`
        : "***";
  return `${visible}@${value.slice(at + 1)}`;
}
export function maskPhone(value) {
  if (!value || typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  return digits.length > 3 ? `•••• ${digits.slice(-3)}` : "••••";
}
export const publicCustomizationPerson = (user) => ({
  id: String(user._id ?? user.id),
  name: user.name ?? null,
  email: maskEmail(user.email),
  phone: maskPhone(user.phone),
});
