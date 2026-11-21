CREATE TABLE "PrejoinWait" (
    "lessonId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PrejoinWait_pkey" PRIMARY KEY ("lessonId", "userId", "clientId"),
    CONSTRAINT "PrejoinWait_lessonId_userId_fkey" FOREIGN KEY ("lessonId", "userId")
        REFERENCES "LessonMember"("lessonId", "userId") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "PrejoinWait_expiresAt_idx" ON "PrejoinWait"("expiresAt");
