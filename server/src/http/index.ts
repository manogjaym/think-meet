import { AttendanceController } from './attendance.controller'
import { AuthController } from './auth.controller'
import { ClassNotesController } from './class-notes.controller'
import { LessonsController } from './lessons.controller'
import { MaterialsController } from './materials.controller'
import { RecordingsController } from './recordings.controller'
import { InternalController, SystemController } from './system.controller'

/** All HTTP controllers; contracts/scripts/check.mjs verifies their routes against contracts/openapi.json. */
export const CONTROLLERS = [SystemController, AuthController, LessonsController, AttendanceController, MaterialsController, ClassNotesController, RecordingsController, InternalController]
export { AuthGuard, TeacherUploadGuard, Public, CurrentUser } from './auth-guard'
export { SystemController, InternalController, AuthController, LessonsController, AttendanceController, MaterialsController, ClassNotesController, RecordingsController }
