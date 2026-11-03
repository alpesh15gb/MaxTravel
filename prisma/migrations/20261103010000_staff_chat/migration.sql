-- CreateTable
CREATE TABLE "StaffChatThread" (
    "nextSequence" INTEGER NOT NULL DEFAULT 0,
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "caseId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StaffChatThread_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ServiceCase" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StaffChatMember" (
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "id" TEXT NOT NULL PRIMARY KEY,
    "threadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" DATETIME,
    "lastReadSequence" INTEGER NOT NULL DEFAULT 0,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StaffChatMember_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "StaffChatThread" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StaffChatMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StaffChatMessage" (
    "sequence" INTEGER NOT NULL,
    "id" TEXT NOT NULL PRIMARY KEY,
    "threadId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StaffChatMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "StaffChatThread" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StaffChatMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffChatThread_key_key" ON "StaffChatThread"("key");

-- CreateIndex
CREATE UNIQUE INDEX "StaffChatThread_caseId_key" ON "StaffChatThread"("caseId");

-- CreateIndex
CREATE INDEX "StaffChatMember_userId_idx" ON "StaffChatMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffChatMember_threadId_userId_key" ON "StaffChatMember"("threadId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffChatMessage_authorId_requestKey_key" ON "StaffChatMessage"("authorId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "StaffChatMessage_threadId_sequence_key" ON "StaffChatMessage"("threadId", "sequence");
