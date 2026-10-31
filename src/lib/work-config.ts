import { z } from "zod";

export const WORK_STATES = [
  "TODO",
  "IN_PROGRESS",
  "WAITING",
  "REVIEW",
  "DONE",
  "CANCELLED",
] as const;
export const WAITING_REASONS = [
  "CUSTOMER",
  "SUPPLIER",
  "INTERNAL",
  "PAYMENT",
  "AUTHORITY",
  "OTHER",
] as const;
export const RESULT_TYPES = [
  "NOTE",
  "DOCUMENTS",
  "QUOTE",
  "BOOKING",
  "VISA_SUBMISSION",
  "VISA_OUTCOME",
  "PAYMENT",
  "BOOKING_RESOLUTION",
] as const;
export function resultsForService(service?: string) {
  return RESULT_TYPES.filter(
    (r) =>
      r === "NOTE" ||
      (Boolean(service) &&
        (r === "PAYMENT" ||
          (service === "VISA"
            ? ["DOCUMENTS", "VISA_SUBMISSION", "VISA_OUTCOME"].includes(r)
            : ["QUOTE", "BOOKING", "BOOKING_RESOLUTION"].includes(r)))),
  );
}
export const serviceSchema = z.enum(["VISA", "FLIGHT", "HOTEL"]);
export const templateStepSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  title: z.string().trim().min(3).max(160),
  instructions: z.string().trim().max(2000),
  requiresReview: z.boolean(),
  resultType: z.enum(RESULT_TYPES),
  prerequisite: z.string().max(40).nullable(),
  required: z.boolean(),
  defaultOwnerId: z.string().max(200).nullable().default(null),
  defaultReviewerId: z.string().max(200).nullable().default(null),
  dueAfterHours: z.number().int().min(1).max(8760).nullable().default(null),
});
export const workConfigSchema = z
  .object({
    version: z.number().int().positive(),
    responseHours: z.number().int().min(1).max(168).default(1),
    escalationUserIds: z.array(z.string().min(1).max(200)).max(10).default([]),
    staleDays: z.number().int().min(1).max(90),
    businessHoursEnabled: z.boolean(),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    openHour: z.number().int().min(0).max(23),
    closeHour: z.number().int().min(1).max(24),
    holidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(366),
    templates: z
      .array(
        z.object({
          service: serviceSchema,
          steps: z.array(templateStepSchema).min(1).max(20),
        }),
      )
      .length(3),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.closeHour <= v.openHour)
      ctx.addIssue({
        code: "custom",
        message: "Closing hour must follow opening hour.",
      });
    if (new Set(v.templates.map((t) => t.service)).size !== 3)
      ctx.addIssue({
        code: "custom",
        message: "Provide one template for each service.",
      });
    for (const t of v.templates) {
      const seen = new Set<string>();
      for (const s of t.steps) {
        if (
          s.requiresReview &&
          s.defaultOwnerId &&
          s.defaultOwnerId === s.defaultReviewerId
        )
          ctx.addIssue({
            code: "custom",
            message: "Default assignee and reviewer must be different.",
          });
        if (!resultsForService(t.service).includes(s.resultType))
          ctx.addIssue({
            code: "custom",
            message: "Choose a result supported by the template service.",
          });
        if (seen.has(s.key) || (s.prerequisite && !seen.has(s.prerequisite)))
          ctx.addIssue({
            code: "custom",
            message:
              "Steps need unique keys and prerequisites earlier in the template.",
          });
        seen.add(s.key);
      }
    }
  });
export type WorkConfig = z.infer<typeof workConfigSchema>;
const step = (
  key: string,
  title: string,
  resultType: (typeof RESULT_TYPES)[number] = "NOTE",
  prerequisite: string | null = null,
  requiresReview = false,
) => ({
  key,
  title,
  resultType,
  prerequisite,
  requiresReview,
  instructions:
    "Record the result and complete the linked business action where required.",
  required: true,
  defaultOwnerId: null,
  defaultReviewerId: null,
  dueAfterHours: null,
});
export const DEFAULT_WORK_CONFIG: WorkConfig = {
  version: 1,
  responseHours: 1,
  escalationUserIds: [],
  staleDays: 7,
  businessHoursEnabled: false,
  weekdays: [1, 2, 3, 4, 5, 6],
  openHour: 9,
  closeHour: 18,
  holidays: [],
  templates: [
    {
      service: "VISA",
      steps: [
        step("requirements", "Assess requirements and request documents"),
        step(
          "documents",
          "Verify the required documents",
          "DOCUMENTS",
          "requirements",
        ),
        step("prepare", "Prepare the application", "NOTE", "documents", true),
        step(
          "submit",
          "Record application submission",
          "VISA_SUBMISSION",
          "prepare",
        ),
        step(
          "decision",
          "Record the authority decision",
          "VISA_OUTCOME",
          "submit",
        ),
      ],
    },
    {
      service: "FLIGHT",
      steps: [
        step("options", "Prepare options and customer acceptance"),
        step("issue", "Verify issued flight tickets", "BOOKING", "options"),
        step(
          "deliver",
          "Deliver itinerary and ticket details",
          "NOTE",
          "issue",
        ),
      ],
    },
    {
      service: "HOTEL",
      steps: [
        step("options", "Confirm the customer's hotel requirements"),
        step(
          "confirm",
          "Verify the supplier confirmation",
          "BOOKING",
          "options",
        ),
        step("voucher", "Deliver the hotel voucher", "NOTE", "confirm"),
      ],
    },
  ],
};
export function readWorkConfig(value?: string | null): WorkConfig {
  try {
    return workConfigSchema.parse(JSON.parse(value ?? ""));
  } catch {
    return structuredClone(DEFAULT_WORK_CONFIG);
  }
}
export function stateOf(task: {
  status: string;
  workState: string;
  workflowTracked: boolean;
}) {
  return task.workflowTracked
    ? task.workState
    : ({
        OPEN: "TODO",
        IN_PROGRESS: "IN_PROGRESS",
        DONE: "DONE",
        CANCELLED: "CANCELLED",
      }[task.status] ?? "TODO");
}
export function legacyStatus(state: string) {
  return state === "DONE"
    ? "DONE"
    : state === "CANCELLED"
      ? "CANCELLED"
      : state === "TODO"
        ? "OPEN"
        : "IN_PROGRESS";
}
export function agencyDay(value = new Date()) {
  const start = new Date(
    Math.floor((value.getTime() + 19800000) / 86400000) * 86400000 - 19800000,
  );
  return { start, end: new Date(start.getTime() + 86400000) };
}
