-- CreateTable
CREATE TABLE "ServiceWork" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "templateVersion" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServiceWork_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ServiceCase" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fromState" TEXT,
    "toState" TEXT NOT NULL,
    "assigneeId" TEXT,
    "assigneeName" TEXT,
    "dueAt" DATETIME,
    "originalDueAt" DATETIME,
    "detail" TEXT NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkMutation" (
    "actorId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("actorId", "requestKey")
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "details" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "dueAt" DATETIME,
    "branchId" TEXT,
    "ownerId" TEXT NOT NULL,
    "creatorId" TEXT,
    "customerId" TEXT,
    "visaCaseId" TEXT,
    "bookingId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "serviceCaseId" TEXT,
    "serviceWorkId" TEXT,
    "workState" TEXT NOT NULL DEFAULT 'TODO',
    "unassigned" BOOLEAN NOT NULL DEFAULT false,
    "originalDueAt" DATETIME,
    "waitingReason" TEXT,
    "nextCheckAt" DATETIME,
    "outcome" TEXT,
    "requiresReview" BOOLEAN NOT NULL DEFAULT false,
    "reviewerId" TEXT,
    "startedAt" DATETIME,
    "submittedAt" DATETIME,
    "reviewedAt" DATETIME,
    "assignedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "workflowTracked" BOOLEAN NOT NULL DEFAULT false,
    "sourceKey" TEXT,
    "prerequisiteId" TEXT,
    "waived" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Task_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Task_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_visaCaseId_fkey" FOREIGN KEY ("visaCaseId") REFERENCES "VisaCase" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_serviceCaseId_fkey" FOREIGN KEY ("serviceCaseId") REFERENCES "ServiceCase" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Task_serviceWorkId_fkey" FOREIGN KEY ("serviceWorkId") REFERENCES "ServiceWork" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Task_prerequisiteId_fkey" FOREIGN KEY ("prerequisiteId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Task" ("bookingId", "branchId", "completedAt", "createdAt", "creatorId", "customerId", "details", "dueAt", "id", "ownerId", "priority", "status", "title", "visaCaseId") SELECT "bookingId", "branchId", "completedAt", "createdAt", "creatorId", "customerId", "details", "dueAt", "id", "ownerId", "priority", "status", "title", "visaCaseId" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
CREATE UNIQUE INDEX "Task_sourceKey_key" ON "Task"("sourceKey");
CREATE INDEX "Task_ownerId_status_idx" ON "Task"("ownerId", "status");
CREATE INDEX "Task_serviceCaseId_status_idx" ON "Task"("serviceCaseId", "status");
CREATE INDEX "Task_branchId_workState_dueAt_idx" ON "Task"("branchId", "workState", "dueAt");
CREATE INDEX "Task_reviewerId_workState_idx" ON "Task"("reviewerId", "workState");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ServiceWork_caseId_service_key" ON "ServiceWork"("caseId", "service");

-- CreateIndex
CREATE INDEX "WorkEvent_taskId_at_idx" ON "WorkEvent"("taskId", "at");

-- CreateIndex
CREATE INDEX "WorkEvent_kind_at_idx" ON "WorkEvent"("kind", "at");

-- CreateIndex
CREATE INDEX "WorkEvent_assigneeId_at_idx" ON "WorkEvent"("assigneeId", "at");

-- Additive backfill: existing identities and recorded completion times are retained.
INSERT INTO "ServiceWork" ("id", "caseId", "service", "title", "createdAt")
SELECT 'work-' || "id", "id", "service", "title", "createdAt" FROM "ServiceCase";

UPDATE "Task" SET "workState" = CASE "status" WHEN 'DONE' THEN 'DONE' WHEN 'CANCELLED' THEN 'CANCELLED' WHEN 'IN_PROGRESS' THEN 'IN_PROGRESS' ELSE 'TODO' END,
 "originalDueAt" = "dueAt", "assignedAt" = "createdAt";

UPDATE "Task" SET "serviceCaseId" = (
 SELECT CASE WHEN b."serviceCaseId" IS NOT NULL AND v."serviceCaseId" IS NOT NULL AND b."serviceCaseId" <> v."serviceCaseId" THEN NULL
 ELSE COALESCE(b."serviceCaseId", v."serviceCaseId") END
 FROM (SELECT 1) x LEFT JOIN "Booking" b ON b."id" = "Task"."bookingId" LEFT JOIN "VisaCase" v ON v."id" = "Task"."visaCaseId"
);
UPDATE "Task" SET "serviceWorkId" = (SELECT w."id" FROM "ServiceWork" w WHERE w."caseId" = "Task"."serviceCaseId" LIMIT 1) WHERE "serviceCaseId" IS NOT NULL;
INSERT INTO "WorkEvent" ("id", "taskId", "actorName", "kind", "toState", "assigneeId", "assigneeName", "dueAt", "originalDueAt", "detail")
SELECT 'baseline-' || t."id", t."id", 'Legacy record', 'BASELINE', t."workState", t."ownerId", u."name", t."dueAt", t."originalDueAt", 'Migration baseline. Earlier assignment and review history is unknown.' FROM "Task" t JOIN "User" u ON u."id" = t."ownerId";

ALTER TABLE "Task" ADD COLUMN "resultType" TEXT NOT NULL DEFAULT 'NOTE';
ALTER TABLE "Task" ADD COLUMN "required" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Task" ADD COLUMN "hardDeadline" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "CaseMessage" (
 "id" TEXT NOT NULL PRIMARY KEY, "caseId" TEXT NOT NULL, "messageId" TEXT NOT NULL, "linkedById" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "CaseMessage_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ServiceCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "CaseMessage_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "WhatsAppMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CaseMessage_caseId_messageId_key" ON "CaseMessage"("caseId", "messageId");
-- Open legacy cases without an action enter an explicit planning queue.
INSERT INTO "Task" ("id","title","details","ownerId","customerId","branchId","serviceCaseId","serviceWorkId","unassigned","workflowTracked","sourceKey")
SELECT 'planning-' || w."id", 'Plan ' || LOWER(w."service") || ' work', 'Review the existing source records, then choose the remaining steps, assignees and deadlines.', c."ownerId", c."customerId", c."branchId", c."id", w."id", true, true, 'plan:' || w."id"
FROM "ServiceWork" w JOIN "ServiceCase" c ON c."id"=w."caseId"
WHERE c."closedAt" IS NULL AND c."status" NOT IN ('COMPLETED','CANCELLED') AND NOT EXISTS (SELECT 1 FROM "Task" t WHERE t."serviceWorkId"=w."id");
ALTER TABLE "WorkEvent" ADD COLUMN "taskTitle" TEXT NOT NULL DEFAULT '';
ALTER TABLE "WorkEvent" ADD COLUMN "caseNo" TEXT;

-- Snapshot the known state at migration time, without inventing earlier actions.
UPDATE WorkEvent SET taskTitle=(SELECT title FROM Task WHERE Task.id=WorkEvent.taskId),caseNo=(SELECT ServiceCase.caseNo FROM Task JOIN ServiceCase ON ServiceCase.id=Task.serviceCaseId WHERE Task.id=WorkEvent.taskId) WHERE kind='BASELINE';
