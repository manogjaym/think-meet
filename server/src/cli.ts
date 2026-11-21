import 'reflect-metadata'
import { PrismaClient } from '@prisma/client'
import * as argon2 from 'argon2'
import { randomBytes, randomUUID } from 'node:crypto'
import { prepareLoadClass } from './load-test'
import { accountPassword, resetAllUserPasswords } from './passwords'
const db = new PrismaClient()
const sampleSubjects = ['바로셈', '수학', '국어', '영어']
async function main() {
  const [command, ...args] = process.argv.slice(2)
  if (command === 'seed') {
    const password = accountPassword(process.env.SEED_PASSWORD, 'SEED_PASSWORD')
    const hash = await argon2.hash(password, { type: argon2.argon2id })
    const teacher = await db.user.upsert({ where: { username: 'teacher1' }, update: {}, create: { username: 'teacher1', name: '윤지아', role: 'teacher', passwordHash: hash } })
    const teachers = await db.user.findMany({ where: { role: 'teacher' }, select: { id: true } })
    await db.teacherSubject.createMany({
      data: teachers.flatMap(({ id }) => sampleSubjects.map(name => ({ teacherId: id, name }))),
      skipDuplicates: true,
    })
    const names = ['김민준','이서윤','박지후','최하은']
    const students = []
    for (let index = 0; index < names.length; index++) {
      const student = await db.user.upsert({ where: { username: `student${index + 1}` }, update: {}, create: { username: `student${index + 1}`, name: names[index], role: 'student', passwordHash: hash } })
      students.push(student)
      await db.teacherStudent.upsert({ where: { teacherId_studentId: { teacherId: teacher.id, studentId: student.id } }, create: { teacherId: teacher.id, studentId: student.id }, update: {} })
    }
    if (!await db.lesson.count({ where: { teacherId: teacher.id } })) {
      const startsAt = new Date(Date.now() + 3600000)
      await db.lesson.create({ data: { title: '분수의 덧셈과 뺄셈', description: '초등 5학년 수학 · 함께 배우는 화상 수업', teacherId: teacher.id, startsAt, endsAt: new Date(startsAt.getTime() + 50 * 60000), code: randomBytes(6).toString('hex'), roomName: `lesson-${randomUUID()}`, members: { create: [teacher.id, ...students.map(s => s.id)].map(userId => ({ userId })) } } })
    }
    console.log('Seed ready: teacher1, student1, student2, student3, student4, and sample teacher subjects. Existing passwords are preserved.')
  } else if (command === 'load:prepare') {
    const result = await prepareLoadClass(db, args[0] === undefined ? 10 : Number(args[0]), process.env.LOAD_TEST_PASSWORD || '')
    console.log(JSON.stringify(result))
  } else if (command === 'user:add') {
    const [username, role, name] = args
    if (!username || !name || !['teacher','student'].includes(role)) throw new Error('Usage: USER_PASSWORD=... npm run cli -- user:add <username> <teacher|student> <name>; password 7 to 200 chars')
    const password = accountPassword(process.env.USER_PASSWORD, 'USER_PASSWORD')
    await db.user.create({ data: { username, role, name, passwordHash: await argon2.hash(password, { type: argon2.argon2id }) } })
    console.log('Account created.')
  } else if (command === 'user:reset') {
    const [username] = args
    if (!username) throw new Error('Usage: USER_PASSWORD=... npm run cli -- user:reset <username>; password 7 to 200 chars')
    const password = accountPassword(process.env.USER_PASSWORD, 'USER_PASSWORD')
    const user = await db.user.update({ where: { username }, data: { passwordHash: await argon2.hash(password, { type: argon2.argon2id }) } })
    await db.loginSession.deleteMany({ where: { userId: user.id } })
    console.log('Password changed and sessions revoked.')
  } else if (command === 'user:reset-all') {
    const result = await resetAllUserPasswords(db, process.env.USER_PASSWORD)
    console.log(`Passwords changed for ${result.users} accounts and ${result.sessions} sessions revoked.`)
  } else if (command === 'roster:add') {
    const [teacherName, studentName] = args
    const teacher = await db.user.findUnique({ where: { username: teacherName || '' } }); const student = await db.user.findUnique({ where: { username: studentName || '' } })
    if (!teacher || teacher.role !== 'teacher' || !student || student.role !== 'student') throw new Error('Usage: npm run cli -- roster:add <teacher username> <student username>')
    await db.teacherStudent.upsert({ where: { teacherId_studentId: { teacherId: teacher.id, studentId: student.id } }, create: { teacherId: teacher.id, studentId: student.id }, update: {} })
    console.log('Roster linked.')
  } else if (command === 'users') {
    console.log(JSON.stringify(await db.user.findMany({ select: { id: true, username: true, name: true, role: true } }), null, 2))
  } else throw new Error('Commands: seed, load:prepare [count], user:add, user:reset, user:reset-all, roster:add, users')
}
main().catch(error => { console.error(error.message); process.exitCode = 1 }).finally(() => db.$disconnect())
