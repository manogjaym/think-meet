CREATE TYPE "StudentAttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'ABSENT');
CREATE TYPE "StudentAttendanceReason" AS ENUM ('DEVICE', 'NETWORK', 'OTHER');

CREATE TABLE "StudentAttendanceOverride" (
    "lessonId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "status" "StudentAttendanceStatus" NOT NULL,
    "reason" "StudentAttendanceReason",
    "memo" VARCHAR(500),
    CONSTRAINT "StudentAttendanceOverride_pkey" PRIMARY KEY ("lessonId","studentId")
);

CREATE INDEX "StudentAttendanceOverride_studentId_idx" ON "StudentAttendanceOverride"("studentId");
ALTER TABLE "StudentAttendanceOverride" ADD CONSTRAINT "StudentAttendanceOverride_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentAttendanceOverride" ADD CONSTRAINT "StudentAttendanceOverride_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
