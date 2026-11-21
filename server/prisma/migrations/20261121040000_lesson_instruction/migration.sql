CREATE TYPE "LessonInstructionPhase" AS ENUM ('preparing', 'classroom', 'mirroring');

ALTER TABLE "Lesson"
    ADD COLUMN "instructionPhase" "LessonInstructionPhase",
    ADD COLUMN "instructionStartedAt" TIMESTAMP(3);
