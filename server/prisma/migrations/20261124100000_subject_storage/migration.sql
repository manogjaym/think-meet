-- DropIndex
DROP INDEX "Material_ownerId_idx";

-- AlterTable
ALTER TABLE "Material" ADD COLUMN     "subjectId" UUID;

-- AlterTable
ALTER TABLE "ClassNoteImage" ADD COLUMN     "subjectId" UUID;

-- CreateIndex
CREATE INDEX "Material_ownerId_subjectId_idx" ON "Material"("ownerId", "subjectId");

-- CreateIndex
CREATE INDEX "ClassNoteImage_subjectId_idx" ON "ClassNoteImage"("subjectId");

-- AddForeignKey
ALTER TABLE "Material" ADD CONSTRAINT "Material_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "TeacherSubject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassNoteImage" ADD CONSTRAINT "ClassNoteImage_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "TeacherSubject"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: existing note images are stored under their lesson's subject. Existing materials stay unclassified.
UPDATE "ClassNoteImage" AS image SET "subjectId" = lesson."subjectId"
FROM "Lesson" AS lesson WHERE lesson."id" = image."lessonId" AND lesson."subjectId" IS NOT NULL;
