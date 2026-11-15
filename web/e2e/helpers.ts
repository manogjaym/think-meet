import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, type APIRequestContext, type Page } from '@playwright/test'

export const env = Object.fromEntries(readFileSync(resolve('../infra/local/.env'),'utf8').split('\n').filter(line=>line && !line.startsWith('#')).map(line=>{ const at=line.indexOf('=');return [line.slice(0,at),line.slice(at+1)] }))
export const password = process.env.TEST_PASSWORD || env.SEED_PASSWORD
export async function login(page: Page, username: string) {
  await page.goto('/login')
  await page.getByLabel('아이디', {exact:true}).fill(username)
  await page.getByLabel('비밀번호', {exact:true}).fill(password)
  await page.getByRole('button',{name:'로그인',exact:true}).click()
  await expect(page.getByRole('heading',{name:'내 수업',exact:true})).toBeVisible()
}
export async function apiLogin(request: APIRequestContext, username: string) {
  const response=await request.post('/api/v1/auth/login',{data:{username,password}})
  expect(response.ok(), await response.text()).toBeTruthy()
}
export async function createLesson(request: APIRequestContext, studentCount=2) {
  const roster=await (await request.get('/api/v1/students')).json()
  const fixtureStudents=roster.filter((student:{username:string})=>/^student[1-4]$/.test(student.username)).sort((a:{username:string},b:{username:string})=>a.username.localeCompare(b.username))
  expect(fixtureStudents.length).toBeGreaterThanOrEqual(studentCount)
  const response=await request.post('/api/v1/lessons',{data:{title:`검증 수업 ${Date.now()}`,description:'자동 검증용 수업',startsAt:new Date(Date.now()+3600000).toISOString(),endsAt:new Date(Date.now()+7200000).toISOString(),studentIds:fixtureStudents.slice(0,studentCount).map((student:{id:string})=>student.id)}})
  expect(response.ok(),await response.text()).toBeTruthy()
  return response.json()
}
