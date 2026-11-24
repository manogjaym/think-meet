CREATE TABLE "LessonRecording" (
    "id" UUID NOT NULL,
    "lessonId" UUID NOT NULL,
    "teacherId" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "objectKey" TEXT NOT NULL,
    "uploadId" TEXT,
    "parts" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'uploading',
    "size" BIGINT NOT NULL,
    "uploadedBytes" BIGINT NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LessonRecording_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LessonRecording_status_check" CHECK (
      ("status" = 'uploading' AND "uploadId" IS NOT NULL AND "uploadedBytes" < "size") OR
      ("status" = 'ready' AND "uploadId" IS NULL AND "uploadedBytes" = "size")
    ),
    CONSTRAINT "LessonRecording_size_check" CHECK ("size" > 0 AND "uploadedBytes" >= 0)
);

CREATE UNIQUE INDEX "LessonRecording_objectKey_key" ON "LessonRecording"("objectKey");
CREATE UNIQUE INDEX "LessonRecording_teacherId_requestId_key" ON "LessonRecording"("teacherId", "requestId");
CREATE INDEX "LessonRecording_teacherId_expiresAt_idx" ON "LessonRecording"("teacherId", "expiresAt");
CREATE INDEX "LessonRecording_lessonId_idx" ON "LessonRecording"("lessonId");
CREATE INDEX "LessonRecording_expiresAt_idx" ON "LessonRecording"("expiresAt");

ALTER TABLE "LessonRecording" ADD CONSTRAINT "LessonRecording_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LessonRecording" ADD CONSTRAINT "LessonRecording_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
