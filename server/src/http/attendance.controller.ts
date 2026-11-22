import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Lessons } from '../lessons'
import { StudentAttendance } from '../student-attendance'
import type { PublicUser } from '../types'
import { CurrentUser } from './auth-guard'

@ApiTags('service')
@Controller('api/v1')
export class AttendanceController {
  constructor(readonly lessons: Lessons, readonly attendance: StudentAttendance) {}
  @Get('students') students(@CurrentUser() user: PublicUser) { return this.lessons.roster(user) }
  @Get('students/:studentId/attendance')
  list(@CurrentUser() user: PublicUser, @Param('studentId') studentId: string, @Query('month') month?: string) { return this.attendance.list(user, studentId, month) }
  @Put('students/:studentId/attendance/:lessonId')
  save(@CurrentUser() user: PublicUser, @Param('studentId') studentId: string, @Param('lessonId') lessonId: string, @Body() body: unknown) {
    return this.attendance.save(user, studentId, lessonId, body)
  }
}
