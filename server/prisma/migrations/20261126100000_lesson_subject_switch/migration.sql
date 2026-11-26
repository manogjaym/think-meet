-- AlterTable
ALTER TABLE "Lesson" ADD COLUMN     "nextLessonId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "Lesson_nextLessonId_key" ON "Lesson"("nextLessonId");

-- AddForeignKey
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_nextLessonId_fkey" FOREIGN KEY ("nextLessonId") REFERENCES "Lesson"("id") ON DELETE SET NULL ON UPDATE CASCADE;
