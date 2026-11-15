import { chromium } from 'playwright'
const { PUBLIC_ORIGIN, LESSON_ID, TEACHER_USERNAME='teacher1', TEACHER_PASSWORD }=process.env
if(!PUBLIC_ORIGIN||!LESSON_ID||!TEACHER_PASSWORD) throw new Error('Missing classroom bootstrap configuration')
const browser=await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']})
try {
  const context=await browser.newContext({permissions:['camera','microphone']})
  const page=await context.newPage()
  await page.goto(`${PUBLIC_ORIGIN}/login`,{waitUntil:'domcontentloaded'})
  await page.getByLabel('아이디',{exact:true}).fill(TEACHER_USERNAME)
  await page.getByLabel('비밀번호',{exact:true}).fill(TEACHER_PASSWORD)
  await page.getByRole('button',{name:'로그인',exact:true}).click()
  await page.getByRole('heading',{name:'내 수업',exact:true}).waitFor({timeout:30000})
  const response=await page.request.get(`${PUBLIC_ORIGIN}/api/v1/lessons/${LESSON_ID}`)
  if(!response.ok()) throw new Error('Classroom lookup failed: '+response.status())
  const lesson=await response.json()
  if(lesson.endsAt!==null) throw new Error('Load classroom must have no scheduled end')
  if(lesson.status==='LIVE') console.log(JSON.stringify({event:'classroom-ready',lessonId:LESSON_ID,alreadyLive:true}))
  else if(lesson.status==='SCHEDULED') {
    await page.goto(`${PUBLIC_ORIGIN}/lessons/${LESSON_ID}/prejoin`,{waitUntil:'domcontentloaded'})
    const mic=page.getByRole('button',{name:'마이크 끄기',exact:true});if(await mic.count()) await mic.click()
    const cam=page.getByRole('button',{name:'카메라 끄기',exact:true});if(await cam.count()) await cam.click()
    await page.getByRole('button',{name:'수업 시작하기',exact:true}).click()
    await page.locator('.call-connected').filter({hasText:'연결됨'}).waitFor({timeout:60000})
    const current=await(await page.request.get(`${PUBLIC_ORIGIN}/api/v1/lessons/${LESSON_ID}`)).json()
    if(current.status!=='LIVE') throw new Error('Teacher connection did not start the class')
    // A personal leave never ends the classroom. The human teacher may now join this same account.
    await page.request.post(`${PUBLIC_ORIGIN}/api/v1/lessons/${LESSON_ID}/leave`)
    console.log(JSON.stringify({event:'classroom-started',lessonId:LESSON_ID,endsAt:null}))
  } else throw new Error('Classroom is closed')
} finally { await browser.close() }
