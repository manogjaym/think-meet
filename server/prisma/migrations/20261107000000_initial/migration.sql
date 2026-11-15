-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginSession" (
    "id" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeacherStudent" (
    "teacherId" UUID NOT NULL,
    "studentId" UUID NOT NULL,

    CONSTRAINT "TeacherStudent_pkey" PRIMARY KEY ("teacherId","studentId")
);

-- CreateTable
CREATE TABLE "Lesson" (
    "id" UUID NOT NULL,
    "teacherId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "code" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "roomName" TEXT NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "share" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonMember" (
    "lessonId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "banned" BOOLEAN NOT NULL DEFAULT false,
    "raised" BOOLEAN NOT NULL DEFAULT false,
    "admissionId" TEXT,
    "online" BOOLEAN NOT NULL DEFAULT false,
    "disconnectedAt" TIMESTAMP(3),

    CONSTRAINT "LessonMember_pkey" PRIMARY KEY ("lessonId","userId")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" UUID NOT NULL,
    "lessonId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "admissionId" TEXT NOT NULL,
    "livekitSid" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" UUID NOT NULL,
    "lessonId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "userName" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Material" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "contentType" TEXT NOT NULL,
    "duration" DOUBLE PRECISION,
    "pages" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Material_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stroke" (
    "id" TEXT NOT NULL,
    "lessonId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "shareId" TEXT NOT NULL,
    "page" INTEGER NOT NULL DEFAULT 1,
    "tool" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "points" JSONB NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Stroke_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnnotationOperation" (
    "id" UUID NOT NULL,
    "lessonId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "shareId" TEXT NOT NULL,
    "page" INTEGER NOT NULL,
    "patches" JSONB NOT NULL,
    "undone" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "touchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnnotationOperation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "LoginSession_userId_idx" ON "LoginSession"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Lesson_code_key" ON "Lesson"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Lesson_roomName_key" ON "Lesson"("roomName");

-- CreateIndex
CREATE INDEX "Lesson_teacherId_startsAt_idx" ON "Lesson"("teacherId", "startsAt");

-- CreateIndex
CREATE INDEX "LessonMember_userId_idx" ON "LessonMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_livekitSid_key" ON "Attendance"("livekitSid");

-- CreateIndex
CREATE INDEX "Attendance_lessonId_userId_idx" ON "Attendance"("lessonId", "userId");

-- CreateIndex
CREATE INDEX "Message_lessonId_createdAt_idx" ON "Message"("lessonId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Message_lessonId_userId_clientId_key" ON "Message"("lessonId", "userId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Material_objectKey_key" ON "Material"("objectKey");

-- CreateIndex
CREATE INDEX "Material_ownerId_idx" ON "Material"("ownerId");

-- CreateIndex
CREATE INDEX "Stroke_lessonId_shareId_page_idx" ON "Stroke"("lessonId", "shareId", "page");

-- CreateIndex
CREATE INDEX "AnnotationOperation_lessonId_actorId_shareId_page_undone_idx" ON "AnnotationOperation"("lessonId", "actorId", "shareId", "page", "undone");

-- AddForeignKey
ALTER TABLE "LoginSession" ADD CONSTRAINT "LoginSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherStudent" ADD CONSTRAINT "TeacherStudent_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherStudent" ADD CONSTRAINT "TeacherStudent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonMember" ADD CONSTRAINT "LessonMember_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stroke" ADD CONSTRAINT "Stroke_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

