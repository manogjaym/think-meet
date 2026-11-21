CREATE TABLE "ClassNoteImage" (
    "id" UUID NOT NULL,
    "lessonId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "studentId" UUID,
    "kind" TEXT NOT NULL,
    "requestId" UUID NOT NULL,
    "originalId" UUID,
    "objectKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClassNoteImage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ClassNoteImage_kind_check" CHECK (
      ("kind" = 'worksheet' AND "studentId" = "authorId" AND "studentId" IS NOT NULL AND "originalId" IS NULL) OR
      ("kind" = 'correction' AND "studentId" IS NOT NULL AND "originalId" IS NOT NULL) OR
      ("kind" = 'capture' AND ("studentId" IS NULL OR "studentId" = "authorId") AND "originalId" IS NULL)
    )
);

CREATE UNIQUE INDEX "ClassNoteImage_originalId_key" ON "ClassNoteImage"("originalId");
CREATE UNIQUE INDEX "ClassNoteImage_objectKey_key" ON "ClassNoteImage"("objectKey");
CREATE UNIQUE INDEX "ClassNoteImage_authorId_requestId_key" ON "ClassNoteImage"("authorId", "requestId");
CREATE INDEX "ClassNoteImage_studentId_kind_createdAt_idx" ON "ClassNoteImage"("studentId", "kind", "createdAt");
CREATE INDEX "ClassNoteImage_lessonId_kind_createdAt_idx" ON "ClassNoteImage"("lessonId", "kind", "createdAt");

ALTER TABLE "ClassNoteImage" ADD CONSTRAINT "ClassNoteImage_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClassNoteImage" ADD CONSTRAINT "ClassNoteImage_originalId_fkey" FOREIGN KEY ("originalId") REFERENCES "ClassNoteImage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
