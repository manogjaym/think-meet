-- Preserve existing schedules while allowing manually ended classes.
ALTER TABLE "Lesson" ALTER COLUMN "endsAt" DROP NOT NULL;
