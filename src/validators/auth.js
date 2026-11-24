import { z } from "zod";

/** Strip the punctuation people type into phone fields. */
export function normalizePhone(value) {
  return value.replace(/[\s()\-.]/g, "");
}

const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address.")
  .max(254, "Email is too long.");

const phoneField = z
  .string()
  .trim()
  .min(8, "Enter a valid phone number.")
  .max(20, "Phone number is too long.")
  .transform(normalizePhone)
  .refine((value) => /^\+?\d{8,15}$/.test(value), {
    message: "Use 8–15 digits, optionally starting with +.",
  });

const passwordField = z
  .string()
  .min(8, "Use at least 8 characters.")
  .max(72, "Use at most 72 characters.")
  .regex(/[A-Za-z]/, "Include at least one letter.")
  .regex(/\d/, "Include at least one number.");

export const registerSchema = z
  .object({
    body: z
      .object({
        name: z.string().trim().min(2, "Name is too short.").max(80).optional(),
        email: emailField.optional(),
        phone: phoneField.optional(),
        password: passwordField,
        remember: z.boolean().optional().default(false),
      })
      .strict()
      .refine((body) => Boolean(body.email || body.phone), {
        message: "Enter an email address or a phone number.",
        path: ["email"],
      }),
    query: z.object({}).strict(),
    params: z.object({}).strict(),
  })
  .strict();

export const loginSchema = z
  .object({
    body: z
      .object({
        identifier: z
          .string()
          .trim()
          .min(3, "Enter your email or phone number.")
          .max(254, "That is too long."),
        password: z
          .string()
          .min(1, "Enter your password.")
          .max(72, "Use at most 72 characters."),
        remember: z.boolean().optional().default(false),
      })
      .strict(),
    query: z.object({}).strict(),
    params: z.object({}).strict(),
  })
  .strict();
