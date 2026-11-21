CREATE TABLE "TeacherSubject" (
    "id" UUID NOT NULL,
    "teacherId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "TeacherSubject_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Lesson" ADD COLUMN "subjectId" UUID;
CREATE UNIQUE INDEX "TeacherSubject_teacherId_name_key" ON "TeacherSubject"("teacherId", "name");
CREATE INDEX "Lesson_subjectId_idx" ON "Lesson"("subjectId");

ALTER TABLE "TeacherSubject" ADD CONSTRAINT "TeacherSubject_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "TeacherSubject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
