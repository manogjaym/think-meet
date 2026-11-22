-- Integrity constraints: enumerated text columns become PostgreSQL enums, and user/lesson references get FKs.
-- Run with the API stopped (Recreate deployment): an older server binds these columns as text.
-- Fails, without partial changes, if any row holds an unknown value or references a missing user/lesson.
-- Pre-check queries: server/README.md "DB 무결성 마이그레이션".

CREATE TYPE "UserRole" AS ENUM ('teacher', 'student');
CREATE TYPE "LessonStatus" AS ENUM ('SCHEDULED', 'LIVE', 'ENDED', 'CANCELLED');
CREATE TYPE "LessonAccessMode" AS ENUM ('INVITE_ONLY', 'OPEN');
CREATE TYPE "MaterialKind" AS ENUM ('media', 'document');
CREATE TYPE "StrokeTool" AS ENUM ('pen', 'highlighter');
CREATE TYPE "ClassNoteImageKind" AS ENUM ('worksheet', 'capture', 'correction');

-- Text CHECKs are replaced: the enum enforces accessMode, and the note-kind rule is recreated on the enum.
ALTER TABLE "Lesson" DROP CONSTRAINT "Lesson_accessMode_check";
ALTER TABLE "ClassNoteImage" DROP CONSTRAINT "ClassNoteImage_kind_check";

ALTER TABLE "User" ALTER COLUMN "role" TYPE "UserRole" USING "role"::"UserRole";

ALTER TABLE "Lesson" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Lesson" ALTER COLUMN "status" TYPE "LessonStatus" USING "status"::"LessonStatus";
ALTER TABLE "Lesson" ALTER COLUMN "status" SET DEFAULT 'SCHEDULED';
ALTER TABLE "Lesson" ALTER COLUMN "accessMode" DROP DEFAULT;
ALTER TABLE "Lesson" ALTER COLUMN "accessMode" TYPE "LessonAccessMode" USING "accessMode"::"LessonAccessMode";
ALTER TABLE "Lesson" ALTER COLUMN "accessMode" SET DEFAULT 'INVITE_ONLY';

ALTER TABLE "Material" ALTER COLUMN "kind" TYPE "MaterialKind" USING "kind"::"MaterialKind";
ALTER TABLE "Stroke" ALTER COLUMN "tool" TYPE "StrokeTool" USING "tool"::"StrokeTool";
ALTER TABLE "ClassNoteImage" ALTER COLUMN "kind" TYPE "ClassNoteImageKind" USING "kind"::"ClassNoteImageKind";
ALTER TABLE "ClassNoteImage" ADD CONSTRAINT "ClassNoteImage_kind_check" CHECK (
  ("kind" = 'worksheet' AND "studentId" = "authorId" AND "studentId" IS NOT NULL AND "originalId" IS NULL) OR
  ("kind" = 'correction' AND "studentId" IS NOT NULL AND "originalId" IS NOT NULL) OR
  ("kind" = 'capture' AND ("studentId" IS NULL OR "studentId" = "authorId") AND "originalId" IS NULL)
);

ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LessonMember" ADD CONSTRAINT "LessonMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Material" ADD CONSTRAINT "Material_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Stroke" ADD CONSTRAINT "Stroke_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AnnotationOperation" ADD CONSTRAINT "AnnotationOperation_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnnotationOperation" ADD CONSTRAINT "AnnotationOperation_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClassNoteImage" ADD CONSTRAINT "ClassNoteImage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClassNoteImage" ADD CONSTRAINT "ClassNoteImage_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
