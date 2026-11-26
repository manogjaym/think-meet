package com.woongjin.thinkmeet.ui

import kotlinx.datetime.LocalDate
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

/** Mirrors server/test/lesson-series.test.ts so the preview count matches what the server books. */
class LessonRepeatTest {
    private val monday = LocalDate(2030, 1, 7)

    @Test fun weeklyAndBiweeklyDates() {
        assertEquals(listOf("2030-01-08", "2030-01-11", "2030-01-15", "2030-01-18"),
            repeatDates(monday, LocalDate(2030, 1, 18), LessonRepeatMode.Weekly, setOf(2, 5)).map { it.toString() })
        assertEquals(listOf("2030-01-07", "2030-01-09", "2030-01-21", "2030-01-23"),
            repeatDates(monday, LocalDate(2030, 1, 28), LessonRepeatMode.Biweekly, setOf(1, 3)).map { it.toString() })
        assertEquals(listOf("2030-01-13", "2030-01-21", "2030-01-27"),
            repeatDates(LocalDate(2030, 1, 13), LocalDate(2030, 1, 28), LessonRepeatMode.Biweekly, setOf(1, 7)).map { it.toString() })
    }

    @Test fun validationAndLimit() {
        val all = (1..7).toSet()
        val hundred = repeatDates(monday, LocalDate(2030, 4, 16), LessonRepeatMode.Weekly, all)
        assertEquals(MaxSeriesLessons, hundred.size)
        assertNull(repeatError(monday, LocalDate(2030, 4, 16), all, hundred))
        val over = repeatDates(monday, LocalDate(2030, 4, 17), LessonRepeatMode.Weekly, all)
        assertNotNull(repeatError(monday, LocalDate(2030, 4, 17), all, over))
        assertNotNull(repeatError(monday, LocalDate(2030, 1, 6), setOf(1), emptyList()))
        assertNotNull(repeatError(monday, LocalDate(2030, 1, 10), emptySet(), emptyList()))
        val saturdays = repeatDates(monday, LocalDate(2030, 1, 10), LessonRepeatMode.Weekly, setOf(6))
        assertNotNull(repeatError(monday, LocalDate(2030, 1, 10), setOf(6), saturdays))
    }
}
