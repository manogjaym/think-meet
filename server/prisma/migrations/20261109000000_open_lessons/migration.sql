ALTER TABLE "Lesson" ADD COLUMN "accessMode" TEXT NOT NULL DEFAULT 'INVITE_ONLY';

ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_accessMode_check" CHECK ("accessMode" IN ('INVITE_ONLY', 'OPEN'));

CREATE INDEX "Lesson_accessMode_status_startsAt_idx" ON "Lesson"("accessMode", "status", "startsAt");
