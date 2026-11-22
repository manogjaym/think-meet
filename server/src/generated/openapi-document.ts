// Generated from contracts/openapi.json. Do not edit.
export const OPENAPI_DOCUMENT = {
  "openapi": "3.0.3",
  "info": {
    "title": "Think Meet shared API",
    "version": "1.0.0",
    "description": "Canonical REST schemas shared by NestJS, React and KMP. Socket.IO is defined in realtime.json."
  },
  "x-contract-revision": 13,
  "servers": [
    {
      "url": "/api/v1"
    }
  ],
  "paths": {
    "/health": {
      "get": {
        "operationId": "health",
        "tags": [
          "health"
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "additionalProperties": true
                }
              }
            }
          },
          "default": {
            "description": "API error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        },
        "security": []
      }
    },
    "/capabilities": {
      "get": {
        "operationId": "capabilities",
        "tags": [
          "capabilities"
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/CapabilitiesResponse"
                }
              }
            }
          },
          "default": {
            "description": "API error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        },
        "security": []
      }
    },
    "/auth/me": {
      "get": {
        "operationId": "authMe",
        "tags": [
          "auth"
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/User"
                }
              }
            }
          },
          "default": {
            "description": "API error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        },
        "security": [
          {
            "sessionCookie": []
          }
        ]
      }
    },
    "/auth/login": {
      "post": {
        "operationId": "authLogin",
        "tags": [
          "auth"
        ],
        "responses": {
          "201": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/User"
                }
              }
            }
          },
          "default": {
            "description": "API error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/LoginInput"
              }
            }
          }
        },
        "security": []
      }
    },
    "/auth/logout": {
      "post": {
        "operationId": "authLogout",
        "tags": [
          "auth"
        ],
        "responses": {
          "201": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "additionalProperties": true
                }
              }
            }
          },
          "default": {
            "description": "API error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        },
        "security": [
          {
            "sessionCookie": []
          }
        ]
      }
    },
    "/students": {
      "get": {
        "operationId": "listStudents",
        "tags": [
          "students"
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/User"
                  }
                }
              }
            }
          },
          "default": {
            "description": "API error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        },
        "security": [
          {
            "sessionCookie": []
          }
        ],
        "x-feature": "classroom.core"
      }
    },
    "/students/{studentId}/attendance": {
      "get": {
        "operationId": "listStudentAttendance",
        "tags": [
          "students"
        ],
        "description": "담당 학생의 월별 출결",
        "parameters": [
          {
            "name": "studentId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          },
          {
            "name": "month",
            "in": "query",
            "required": true,
            "schema": {
              "type": "string",
              "pattern": "^[2-9]\\d{3}-(0[1-9]|1[0-2])$"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/StudentAttendanceMonth"
                }
              }
            }
          },
          "default": {
            "description": "API error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        },
        "security": [
          {
            "sessionCookie": []
          }
        ],
        "x-feature": "classroom.attendance"
      }
    },
    "/students/{studentId}/attendance/{lessonId}": {
      "put": {
        "operationId": "saveStudentAttendance",
        "tags": [
          "students"
        ],
        "description": "출결 수정 내용을 저장하고 수업이 속한 월의 출결을 반환",
        "parameters": [
          {
            "name": "studentId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          },
          {
            "name": "lessonId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/StudentAttendanceMonth"
                }
              }
            }
          },
          "default": {
            "description": "API error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        },
        "security": [
          {
            "sessionCookie": []
          }
        ],
        "x-feature": "classroom.attendance",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/StudentAttendanceInput"
              }
            }
          }
        }
      }
    },
    "/subjects": {
      "get": {
        "operationId": "listTeacherSubjects",
        "tags": [
          "lessons"
        ],
        "responses": {
          "200": {
            "description": "Signed-in teacher's subjects",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/TeacherSubject"
                  }
                }
              }
            }
          },
          "default": {
            "description": "API error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        },
        "security": [
          {
            "sessionCookie": []
          }
        ],
        "x-feature": "classroom.subjects"
      }
    },
    "/lessons": {
      "get": {
        "operationId": "listLessons",
        "tags": [
          "lessons"
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/Lesson"
                  }
                }
              }
            }
          },
          "default": {
            "description": "API error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        },
        "security": [
          {
            "sessionCookie": []
          }
        ],
        "x-feature": "classroom.core"
      },
      "post": {
        "operationId": "createLesson",
        "tags": [
          "lessons"
        ],
        "responses": {
          "201": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Lesson"
                }
              }
            }
          },
          "default": {
            "description": "API error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/LessonInput"
              }
            }
          }
        },
        "security": [
          {
            "sessionCookie": []
          }
        ],
        "x-feature": "classroom.core"
      }
    },
    "/join/{code}": {
      "get": {
        "operationId": "resolveLesson",
        "tags": [
          "join"
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Lesson"
                }
              }
            }
          },
          "default": {
            "description": "API error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        },
        "security": [
          {
            "sessionCookie": []
          }
        ],
        "x-feature": "classroom.core",
        "parameters": [
          {
            "name": "code",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ]
      }
    },
    "/lessons/{id}": {
      "get": {
        "operationId": "getLesson",
        "tags": [
          "lessons"
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Lesson"
                }
              }
            }
          },
          "default": {
            "description": "API error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        },
        "security": [
          {
            "sessionCookie": []
          }
        ],
        "x-feature": "classroom.core",
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ]
      },
      "patch": {
        "operationId": "updateLesson",
        "tags": [
          "lessons"
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Lesson"
                }
              }
            }
          },
          "default": {
            "description": "API error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/LessonInput"
              }
            }
          }
        },
        "security": [
          {
            "sessionCookie": []
          }
        ],
        "x-feature": "classroom.core",
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ]
      }
    },
    "/lessons/{id}/cancel": {
      "post": {
        "operationId": "cancelLesson",
        "tags": [
          "lessons"
        ],
        "responses": {
          "201": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Lesson"
                }
              }
            }
          },
          "default": {
            "description": "API error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        },
        "security": [
          {
            "sessionCookie": []
          }
        ],
        "x-feature": "classroom.core",
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ]
      }
    },
    "/lessons/{id}/connected": {
      "post": {
        "operationId": "connectedLesson",
        "tags": [
          "lessons"
        ],
        "responses": {
          "201": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Lesson"
                }
              }
            }
          },
          "default": {
            "description": "API error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        },
        "security": [
          {
            "sessionCookie": []
          }
        ],
        "x-feature": "classroom.core",
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ]
      }
    },
    "/lessons/{id}/end": {
      "post": {
        "operationId": "endLesson",
        "tags": [
          "lessons"
        ],
        "responses": {
          "201": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Lesson"
                }
              }
            }
          },
          "default": {
            "description": "API error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        },
        "security": [
          {
            "sessionCookie": []
          }
        ],
        "x-feature": "classroom.core",
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "x-cleanup": true
      }
    },
    "/lessons/{id}/join": {
      "post": {
        "operationId": "joinLesson",
        "tags": [
          "lessons"
        ],
        "responses": {
          "201": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/JoinResult"
                }
              }
            }
          },
          "default": {
            "description": "API error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        },
        "security": [
          {
            "sessionCookie": []
          }
        ],
        "x-feature": "classroom.core",
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ]
      }
    },
    "/lessons/{id}/leave": {
      "post": {
        "operationId": "leaveLesson",
        "tags": [
          "lessons"
        ],
        "responses": {
          "201": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "additionalProperties": true
                }
              }
            }
          },
          "default": {
            "description": "API error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        },
        "security": [
          {
            "sessionCookie": []
          }
        ],
        "x-feature": "classroom.core",
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "x-cleanup": true
      }
    },
    "/lessons/{id}/kick": {
      "post": {
        "operationId": "kickParticipant",
        "tags": [
          "lessons"
        ],
        "responses": {
          "201": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "additionalProperties": true
                }
              }
            }
          },
          "default": {
            "description": "API error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/KickInput"
              }
            }
          }
        },
        "security": [
          {
            "sessionCookie": []
          }
        ],
        "x-feature": "classroom.core",
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ]
      }
    },
    "/lessons/{id}/invites": {
      "post": {
        "operationId": "inviteStudents",
        "tags": [
          "lessons"
        ],
        "responses": {
          "201": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Lesson"
                }
              }
            }
          },
          "default": {
            "description": "API error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/InviteInput"
              }
            }
          }
        },
        "security": [
          {
            "sessionCookie": []
          }
        ],
        "x-feature": "classroom.core",
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ]
      }
    },
    "/lessons/{id}/snapshot": {
      "get": {
        "operationId": "getSnapshot",
        "tags": [
          "lessons"
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/MeetingSnapshot"
                }
              }
            }
          },
          "default": {
            "description": "API error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        },
        "security": [
          {
            "sessionCookie": []
          }
        ],
        "x-feature": "classroom.core",
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ]
      }
    },
    "/materials": {
      "get": {
        "operationId": "listMaterials",
        "tags": [
          "materials"
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/Material"
                  }
                }
              }
            }
          },
          "default": {
            "description": "API error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        },
        "security": [
          {
            "sessionCookie": []
          }
        ],
        "x-feature": "classroom.core"
      },
      "post": {
        "operationId": "uploadMaterial",
        "tags": [
          "materials"
        ],
        "responses": {
          "201": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Material"
                }
              }
            }
          },
          "default": {
            "description": "API error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        },
        "security": [
          {
            "sessionCookie": []
          }
        ],
        "x-feature": "classroom.core",
        "requestBody": {
          "required": true,
          "content": {
            "multipart/form-data": {
              "schema": {
                "type": "object",
                "properties": {
                  "file": {
                    "type": "string",
                    "format": "binary"
                  }
                },
                "required": [
                  "file"
                ]
              }
            }
          }
        }
      }
    },
    "/materials/{id}": {
      "delete": {
        "operationId": "deleteMaterial",
        "tags": [
          "materials"
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "additionalProperties": true
                }
              }
            }
          },
          "default": {
            "description": "API error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        },
        "security": [
          {
            "sessionCookie": []
          }
        ],
        "x-feature": "classroom.core",
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ]
      }
    },
    "/materials/{id}/content": {
      "get": {
        "operationId": "getMaterialContent",
        "tags": [
          "materials"
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/octet-stream": {
                "schema": {
                  "type": "string",
                  "format": "binary"
                }
              }
            }
          },
          "206": {
            "description": "Partial byte range"
          },
          "416": {
            "description": "Invalid byte range"
          },
          "default": {
            "description": "API error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        },
        "security": [
          {
            "sessionCookie": []
          }
        ],
        "x-feature": "classroom.core",
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "lessonId",
            "in": "query",
            "required": false,
            "schema": {
              "type": "string"
            }
          }
        ]
      }
    },
    "/webhooks/livekit": {
      "post": {
        "operationId": "livekitWebhook",
        "tags": [
          "webhooks"
        ],
        "responses": {
          "201": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "additionalProperties": true
                }
              }
            }
          },
          "default": {
            "description": "API error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        },
        "security": [],
        "requestBody": {
          "required": true,
          "content": {
            "application/webhook+json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "description": "Raw signed LiveKit body; authentication remains signature-based."
      }
    },
    "/class-notes/target": {
      "get": {
        "operationId": "getClassNoteTarget",
        "tags": [
          "class notes"
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ClassNoteTarget"
                }
              }
            }
          },
          "default": {
            "description": "API error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        },
        "security": [
          {
            "sessionCookie": []
          }
        ],
        "x-feature": "classroom.notes"
      }
    },
    "/class-notes/worksheets": {
      "get": {
        "operationId": "listClassNoteWorksheets",
        "tags": [
          "class notes"
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/ClassNoteWorksheet"
                  }
                }
              }
            }
          },
          "default": {
            "description": "API error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        },
        "security": [
          {
            "sessionCookie": []
          }
        ],
        "x-feature": "classroom.notes",
        "parameters": [
          {
            "name": "month",
            "in": "query",
            "required": false,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "lessonId",
            "in": "query",
            "required": false,
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          }
        ]
      }
    },
    "/class-notes/lessons/{id}/worksheets": {
      "post": {
        "operationId": "submitClassNoteWorksheet",
        "tags": [
          "class notes"
        ],
        "responses": {
          "201": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ClassNoteImage"
                }
              }
            }
          },
          "default": {
            "description": "API error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        },
        "security": [
          {
            "sessionCookie": []
          }
        ],
        "x-feature": "classroom.notes",
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "multipart/form-data": {
              "schema": {
                "type": "object",
                "properties": {
                  "file": {
                    "type": "string",
                    "format": "binary"
                  },
                  "requestId": {
                    "type": "string",
                    "format": "uuid"
                  }
                },
                "required": [
                  "file",
                  "requestId"
                ]
              }
            }
          }
        }
      }
    },
    "/class-notes/worksheets/{id}/correction": {
      "post": {
        "operationId": "submitClassNoteCorrection",
        "tags": [
          "class notes"
        ],
        "responses": {
          "201": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ClassNoteImage"
                }
              }
            }
          },
          "default": {
            "description": "API error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        },
        "security": [
          {
            "sessionCookie": []
          }
        ],
        "x-feature": "classroom.notes",
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "multipart/form-data": {
              "schema": {
                "type": "object",
                "properties": {
                  "file": {
                    "type": "string",
                    "format": "binary"
                  },
                  "requestId": {
                    "type": "string",
                    "format": "uuid"
                  }
                },
                "required": [
                  "file",
                  "requestId"
                ]
              }
            }
          }
        }
      }
    },
    "/class-notes/captures": {
      "get": {
        "operationId": "listClassNoteCaptures",
        "tags": [
          "class notes"
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/ClassNoteCapture"
                  }
                }
              }
            }
          },
          "default": {
            "description": "API error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        },
        "security": [
          {
            "sessionCookie": []
          }
        ],
        "x-feature": "classroom.notes"
      }
    },
    "/class-notes/lessons/{id}/captures": {
      "post": {
        "operationId": "saveClassNoteCapture",
        "tags": [
          "class notes"
        ],
        "responses": {
          "201": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ClassNoteImage"
                }
              }
            }
          },
          "default": {
            "description": "API error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        },
        "security": [
          {
            "sessionCookie": []
          }
        ],
        "x-feature": "classroom.notes",
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "multipart/form-data": {
              "schema": {
                "type": "object",
                "properties": {
                  "file": {
                    "type": "string",
                    "format": "binary"
                  },
                  "requestId": {
                    "type": "string",
                    "format": "uuid"
                  },
                  "shareId": {
                    "type": "string",
                    "format": "uuid"
                  },
                  "page": {
                    "type": "integer",
                    "minimum": 1
                  },
                  "admissionId": {
                    "type": "string",
                    "format": "uuid"
                  }
                },
                "required": [
                  "file",
                  "requestId",
                  "shareId",
                  "page",
                  "admissionId"
                ]
              }
            }
          }
        }
      }
    },
    "/class-notes/images/{id}": {
      "get": {
        "operationId": "getClassNoteImage",
        "tags": [
          "class notes"
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "image/jpeg": {
                "schema": {
                  "type": "string",
                  "format": "binary"
                }
              },
              "image/png": {
                "schema": {
                  "type": "string",
                  "format": "binary"
                }
              }
            }
          },
          "default": {
            "description": "API error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        },
        "security": [
          {
            "sessionCookie": []
          }
        ],
        "x-feature": "classroom.notes",
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          }
        ]
      }
    },
    "/lessons/{id}/prejoin": {
      "get": {
        "operationId": "getPrejoinStatus",
        "tags": [
          "lessons"
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/PrejoinStatus"
                }
              }
            }
          },
          "default": {
            "description": "API error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        },
        "security": [
          {
            "sessionCookie": []
          }
        ],
        "x-feature": "classroom.prejoin",
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          }
        ]
      }
    },
    "/lessons/{id}/waiting/{clientId}": {
      "put": {
        "operationId": "renewPrejoinWait",
        "tags": [
          "lessons"
        ],
        "responses": {
          "204": {
            "description": "Waiting presence renewed"
          },
          "default": {
            "description": "API error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        },
        "security": [
          {
            "sessionCookie": []
          }
        ],
        "x-feature": "classroom.prejoin",
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          },
          {
            "name": "clientId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          }
        ]
      },
      "delete": {
        "operationId": "clearPrejoinWait",
        "tags": [
          "lessons"
        ],
        "responses": {
          "204": {
            "description": "Waiting presence cleared"
          },
          "default": {
            "description": "API error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        },
        "security": [
          {
            "sessionCookie": []
          }
        ],
        "x-feature": "classroom.prejoin",
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          },
          {
            "name": "clientId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          }
        ]
      }
    }
  },
  "components": {
    "securitySchemes": {
      "sessionCookie": {
        "type": "apiKey",
        "in": "cookie",
        "name": "think_meet_session"
      }
    },
    "schemas": {
      "Role": {
        "type": "string",
        "enum": [
          "teacher",
          "student"
        ]
      },
      "LessonAccessMode": {
        "type": "string",
        "enum": [
          "INVITE_ONLY",
          "OPEN"
        ]
      },
      "User": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "username": {
            "type": "string"
          },
          "name": {
            "type": "string"
          },
          "role": {
            "$ref": "#/components/schemas/Role"
          }
        },
        "required": [
          "id",
          "username",
          "name",
          "role"
        ],
        "x-kotlin-helper": "user"
      },
      "LessonParticipant": {
        "type": "object",
        "properties": {
          "userId": {
            "type": "string"
          },
          "joinedAt": {
            "type": "string",
            "format": "date-time"
          }
        },
        "required": [
          "userId",
          "joinedAt"
        ]
      },
      "Attendance": {
        "type": "object",
        "properties": {
          "userId": {
            "type": "string"
          },
          "joinedAt": {
            "type": "string",
            "format": "date-time"
          },
          "leftAt": {
            "type": "string",
            "format": "date-time",
            "nullable": true,
            "default": null
          }
        },
        "required": [
          "userId",
          "joinedAt",
          "leftAt"
        ]
      },
      "TeacherSubject": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "name": {
            "type": "string"
          }
        },
        "required": [
          "id",
          "name"
        ]
      },
      "Lesson": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "title": {
            "type": "string"
          },
          "description": {
            "type": "string",
            "default": ""
          },
          "accessMode": {
            "allOf": [
              {
                "$ref": "#/components/schemas/LessonAccessMode"
              }
            ],
            "default": "INVITE_ONLY"
          },
          "teacher": {
            "$ref": "#/components/schemas/User"
          },
          "subject": {
            "$ref": "#/components/schemas/TeacherSubject"
          },
          "instruction": {
            "$ref": "#/components/schemas/LessonInstruction"
          },
          "students": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/User"
            },
            "default": []
          },
          "startsAt": {
            "type": "string",
            "format": "date-time"
          },
          "endsAt": {
            "type": "string",
            "format": "date-time",
            "nullable": true,
            "default": null
          },
          "status": {
            "type": "string",
            "enum": [
              "SCHEDULED",
              "LIVE",
              "ENDED",
              "CANCELLED"
            ]
          },
          "code": {
            "type": "string"
          },
          "startedAt": {
            "type": "string",
            "format": "date-time",
            "nullable": true,
            "default": null
          },
          "endedAt": {
            "type": "string",
            "format": "date-time",
            "nullable": true,
            "default": null
          },
          "participants": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/LessonParticipant"
            },
            "default": []
          },
          "attendance": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/Attendance"
            },
            "default": []
          }
        },
        "required": [
          "id",
          "title",
          "description",
          "teacher",
          "students",
          "startsAt",
          "endsAt",
          "status",
          "code",
          "startedAt",
          "endedAt"
        ],
        "x-kotlin-helper": "lesson"
      },
      "LessonInput": {
        "type": "object",
        "properties": {
          "title": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          },
          "subjectId": {
            "type": "string",
            "format": "uuid",
            "nullable": true,
            "description": "Omit on update to preserve the subject, or send null to clear it."
          },
          "description": {
            "type": "string",
            "default": "",
            "maxLength": 5000
          },
          "startsAt": {
            "type": "string",
            "format": "date-time"
          },
          "endsAt": {
            "type": "string",
            "format": "date-time",
            "nullable": true
          },
          "accessMode": {
            "allOf": [
              {
                "$ref": "#/components/schemas/LessonAccessMode"
              }
            ],
            "default": "INVITE_ONLY"
          },
          "studentIds": {
            "type": "array",
            "items": {
              "type": "string",
              "format": "uuid"
            },
            "default": [],
            "maxItems": 100
          }
        },
        "required": [
          "title",
          "startsAt",
          "endsAt"
        ]
      },
      "JoinResult": {
        "type": "object",
        "properties": {
          "waiting": {
            "type": "boolean"
          },
          "lesson": {
            "$ref": "#/components/schemas/Lesson"
          },
          "token": {
            "type": "string"
          },
          "livekitUrl": {
            "type": "string"
          },
          "admissionId": {
            "type": "string",
            "format": "uuid"
          }
        },
        "required": [
          "waiting",
          "lesson"
        ]
      },
      "Material": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "name": {
            "type": "string"
          },
          "type": {
            "type": "string",
            "enum": [
              "media",
              "document"
            ]
          },
          "size": {
            "type": "integer",
            "format": "int64"
          },
          "duration": {
            "type": "number",
            "format": "double",
            "nullable": true
          },
          "pages": {
            "type": "integer",
            "nullable": true
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          }
        },
        "required": [
          "id",
          "name",
          "type",
          "size",
          "createdAt"
        ]
      },
      "Share": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "type": {
            "type": "string",
            "enum": [
              "screen",
              "media",
              "document"
            ]
          },
          "ownerId": {
            "type": "string"
          },
          "materialId": {
            "type": "string"
          },
          "material": {
            "$ref": "#/components/schemas/Material"
          },
          "page": {
            "type": "integer",
            "default": 1
          },
          "playing": {
            "type": "boolean",
            "default": false
          },
          "position": {
            "type": "number",
            "format": "double",
            "default": 0
          },
          "updatedAt": {
            "type": "string",
            "format": "date-time"
          },
          "assistanceId": {
            "type": "string"
          }
        },
        "required": [
          "id",
          "type",
          "ownerId",
          "page",
          "playing",
          "position",
          "updatedAt"
        ]
      },
      "Point": {
        "type": "object",
        "properties": {
          "x": {
            "type": "number",
            "format": "double",
            "minimum": 0,
            "maximum": 1
          },
          "y": {
            "type": "number",
            "format": "double",
            "minimum": 0,
            "maximum": 1
          }
        },
        "required": [
          "x",
          "y"
        ]
      },
      "Stroke": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "authorId": {
            "type": "string"
          },
          "shareId": {
            "type": "string"
          },
          "page": {
            "type": "integer"
          },
          "tool": {
            "type": "string",
            "enum": [
              "pen",
              "highlighter"
            ]
          },
          "color": {
            "type": "string"
          },
          "points": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/Point"
            }
          },
          "deleted": {
            "type": "boolean",
            "default": false
          }
        },
        "required": [
          "id",
          "authorId",
          "shareId",
          "page",
          "tool",
          "color",
          "points",
          "deleted"
        ]
      },
      "PreviewStroke": {
        "type": "object",
        "properties": {
          "shareId": {
            "type": "string"
          },
          "page": {
            "type": "integer"
          },
          "tool": {
            "type": "string",
            "enum": [
              "pen",
              "highlighter"
            ]
          },
          "color": {
            "type": "string"
          },
          "points": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/Point"
            }
          },
          "authorId": {
            "type": "string"
          }
        },
        "required": [
          "shareId",
          "page",
          "tool",
          "color",
          "points"
        ]
      },
      "StrokePreview": {
        "type": "object",
        "properties": {
          "lessonId": {
            "type": "string"
          },
          "shareId": {
            "type": "string"
          },
          "page": {
            "type": "integer"
          },
          "tool": {
            "type": "string",
            "enum": [
              "pen",
              "highlighter"
            ]
          },
          "color": {
            "type": "string"
          },
          "points": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/Point"
            }
          },
          "authorId": {
            "type": "string"
          }
        },
        "required": [
          "lessonId",
          "shareId",
          "page",
          "tool",
          "color",
          "points"
        ]
      },
      "MeetingParticipant": {
        "type": "object",
        "properties": {
          "user": {
            "$ref": "#/components/schemas/User"
          },
          "online": {
            "type": "boolean",
            "default": false
          },
          "raised": {
            "type": "boolean",
            "default": false
          },
          "annotationAllowed": {
            "type": "boolean",
            "description": "이 참여자가 지금 판서할 수 있는지 나타냅니다. 선생님과 수업 모드가 없는 수업은 항상 true입니다. 값이 없으면 구버전 서버이므로 기존처럼 판서를 허용합니다."
          }
        },
        "required": [
          "user",
          "online",
          "raised"
        ]
      },
      "ChatMessage": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "clientId": {
            "type": "string"
          },
          "userId": {
            "type": "string"
          },
          "userName": {
            "type": "string"
          },
          "text": {
            "type": "string"
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          }
        },
        "required": [
          "id",
          "clientId",
          "userId",
          "userName",
          "text",
          "createdAt"
        ]
      },
      "LessonInstruction": {
        "type": "object",
        "properties": {
          "phase": {
            "type": "string",
            "enum": [
              "preparing",
              "classroom",
              "mirroring"
            ]
          },
          "startedAt": {
            "type": "string",
            "format": "date-time",
            "nullable": true
          }
        },
        "required": [
          "phase",
          "startedAt"
        ]
      },
      "MeetingSnapshot": {
        "type": "object",
        "properties": {
          "lessonId": {
            "type": "string"
          },
          "lesson": {
            "$ref": "#/components/schemas/Lesson"
          },
          "instruction": {
            "$ref": "#/components/schemas/LessonInstruction"
          },
          "participants": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/MeetingParticipant"
            },
            "default": []
          },
          "messages": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/ChatMessage"
            },
            "default": []
          },
          "share": {
            "allOf": [
              {
                "$ref": "#/components/schemas/Share"
              }
            ],
            "nullable": true,
            "default": null
          },
          "strokes": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/Stroke"
            },
            "default": []
          },
          "seq": {
            "type": "integer",
            "format": "int64",
            "default": 0
          },
          "serverTime": {
            "type": "string",
            "format": "date-time"
          },
          "assistance": {
            "allOf": [
              {
                "$ref": "#/components/schemas/AssistanceSession"
              }
            ],
            "nullable": true
          }
        },
        "required": [
          "lessonId",
          "lesson",
          "participants",
          "messages",
          "share",
          "strokes",
          "seq",
          "serverTime"
        ]
      },
      "RealtimeError": {
        "type": "object",
        "properties": {
          "code": {
            "type": "string",
            "default": "CONNECTION"
          },
          "message": {
            "type": "string",
            "default": "연결을 확인해 주세요."
          }
        },
        "required": [
          "code",
          "message"
        ]
      },
      "ErrorResponse": {
        "type": "object",
        "properties": {
          "code": {
            "type": "string"
          },
          "message": {
            "type": "string"
          }
        },
        "required": [
          "code",
          "message"
        ]
      },
      "ErrorCode": {
        "type": "string",
        "description": "서버가 ErrorResponse.code·RealtimeError.code에 보내는 값의 전체 목록입니다. 두 code 필드는 호환성을 위해 string으로 유지하며, 새 코드는 이 목록에 추가한 뒤 사용합니다.",
        "enum": [
          "ACCOUNT",
          "ANNOTATION_NOT_ALLOWED",
          "ASSISTANCE_BUSY",
          "ASSISTANCE_UNAVAILABLE",
          "CANCELLED",
          "CLIENT_UPDATE_REQUIRED",
          "CONFLICT",
          "CONNECTION",
          "CONSENT_REQUIRED",
          "ENDED",
          "FEATURE_UNAVAILABLE",
          "FILE_TOO_LARGE",
          "FORBIDDEN",
          "INTERNAL",
          "INVALID",
          "INVALID_CREDENTIALS",
          "INVALID_FILE",
          "INVALID_MATERIAL",
          "INVALID_SIGNATURE",
          "KICKED",
          "LESSON_MODE_CHANGED",
          "LESSON_MODE_REQUIRED",
          "LESSON_NOT_STARTED",
          "LIVE",
          "MATERIAL_IN_USE",
          "NOTE_SHARE_CHANGED",
          "NOTE_TARGET_CHANGED",
          "NOT_CONNECTED",
          "NOT_FOUND",
          "NOT_READY",
          "NO_SHARE",
          "PARTICIPANT_UNAVAILABLE",
          "RATE_LIMIT",
          "REQUEST_FAILED",
          "SCREEN_NOT_PUBLISHED",
          "SHARE_BUSY",
          "STALE_ASSISTANCE",
          "STALE_GEOMETRY",
          "STALE_SHARE",
          "UNAUTHENTICATED",
          "UNKNOWN_COMMAND",
          "UNSUPPORTED_CODEC",
          "UNSUPPORTED_FILE",
          "UPLOAD_CANCELLED",
          "VALIDATION",
          "WAITING"
        ]
      },
      "LoginInput": {
        "type": "object",
        "properties": {
          "username": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "password": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          }
        },
        "required": [
          "username",
          "password"
        ]
      },
      "KickInput": {
        "type": "object",
        "properties": {
          "userId": {
            "type": "string",
            "format": "uuid"
          }
        },
        "required": [
          "userId"
        ]
      },
      "InviteInput": {
        "type": "object",
        "properties": {
          "studentIds": {
            "type": "array",
            "items": {
              "type": "string",
              "format": "uuid"
            },
            "minItems": 1,
            "maxItems": 100
          }
        },
        "required": [
          "studentIds"
        ]
      },
      "SubscribeInput": {
        "type": "object",
        "properties": {
          "lessonId": {
            "type": "string",
            "format": "uuid"
          }
        },
        "required": [
          "lessonId"
        ]
      },
      "CommandEnvelope": {
        "type": "object",
        "properties": {
          "lessonId": {
            "type": "string",
            "format": "uuid"
          },
          "type": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "payload": {
            "type": "object",
            "additionalProperties": true,
            "default": {}
          },
          "requestId": {
            "type": "string",
            "maxLength": 100
          },
          "expectedShareId": {
            "type": "string",
            "format": "uuid",
            "description": "For share.stop, only stop the currently selected share if it has this ID. Omitted by legacy clients. Supported since revision 5."
          }
        },
        "required": [
          "lessonId",
          "type"
        ]
      },
      "SuccessAck": {
        "type": "object",
        "properties": {
          "ok": {
            "type": "boolean",
            "enum": [
              true
            ],
            "default": true
          },
          "snapshot": {
            "$ref": "#/components/schemas/MeetingSnapshot"
          }
        },
        "required": [
          "ok",
          "snapshot"
        ]
      },
      "ErrorAck": {
        "type": "object",
        "properties": {
          "ok": {
            "type": "boolean",
            "enum": [
              false
            ],
            "default": false
          },
          "error": {
            "$ref": "#/components/schemas/RealtimeError"
          }
        },
        "required": [
          "ok",
          "error"
        ]
      },
      "CommandAck": {
        "oneOf": [
          {
            "$ref": "#/components/schemas/SuccessAck"
          },
          {
            "$ref": "#/components/schemas/ErrorAck"
          }
        ]
      },
      "CapabilitiesResponse": {
        "type": "object",
        "properties": {
          "contractRevision": {
            "type": "integer",
            "minimum": 0
          },
          "features": {
            "type": "object",
            "additionalProperties": {
              "type": "boolean"
            }
          }
        },
        "required": [
          "contractRevision",
          "features"
        ]
      },
      "ChatSendPayload": {
        "type": "object",
        "properties": {
          "text": {
            "type": "string",
            "minLength": 1,
            "maxLength": 2000
          },
          "clientId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          }
        },
        "required": [
          "text",
          "clientId"
        ]
      },
      "HandSetPayload": {
        "type": "object",
        "properties": {
          "raised": {
            "type": "boolean"
          }
        },
        "required": [
          "raised"
        ]
      },
      "LessonModeSetPayload": {
        "type": "object",
        "properties": {
          "mode": {
            "type": "string",
            "enum": [
              "classroom",
              "mirroring"
            ]
          },
          "expectedMode": {
            "type": "string",
            "enum": [
              "classroom",
              "mirroring"
            ]
          },
          "expectedShareId": {
            "type": "string",
            "format": "uuid",
            "nullable": true
          },
          "expectedAssistanceId": {
            "type": "string",
            "format": "uuid",
            "nullable": true
          }
        },
        "required": [
          "mode",
          "expectedMode",
          "expectedShareId",
          "expectedAssistanceId"
        ]
      },
      "DocumentOpenPayload": {
        "type": "object",
        "properties": {
          "materialId": {
            "type": "string",
            "format": "uuid"
          },
          "page": {
            "type": "integer",
            "minimum": 1
          }
        },
        "required": [
          "materialId",
          "page"
        ]
      },
      "ShareStartPayload": {
        "type": "object",
        "properties": {
          "type": {
            "type": "string",
            "enum": [
              "screen",
              "media",
              "document"
            ]
          },
          "materialId": {
            "type": "string",
            "format": "uuid"
          }
        },
        "required": [
          "type"
        ]
      },
      "EmptyPayload": {
        "type": "object",
        "properties": {},
        "required": []
      },
      "MediaUpdatePayload": {
        "type": "object",
        "properties": {
          "playing": {
            "type": "boolean"
          },
          "position": {
            "type": "number",
            "format": "double",
            "minimum": 0
          }
        },
        "required": [
          "playing",
          "position"
        ]
      },
      "DocumentPagePayload": {
        "type": "object",
        "properties": {
          "page": {
            "type": "integer",
            "minimum": 1
          }
        },
        "required": [
          "page"
        ]
      },
      "StrokeAddPayload": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "shareId": {
            "type": "string",
            "format": "uuid"
          },
          "page": {
            "type": "integer",
            "minimum": 1
          },
          "tool": {
            "type": "string",
            "enum": [
              "pen",
              "highlighter"
            ]
          },
          "color": {
            "type": "string",
            "pattern": "^#[0-9a-fA-F]{6}$"
          },
          "points": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/Point"
            },
            "minItems": 1,
            "maxItems": 20000
          }
        },
        "required": [
          "id",
          "shareId",
          "page",
          "tool",
          "color",
          "points"
        ]
      },
      "StrokeErasePayload": {
        "type": "object",
        "properties": {
          "ids": {
            "type": "array",
            "items": {
              "type": "string",
              "format": "uuid"
            },
            "maxItems": 500
          }
        },
        "required": [
          "ids"
        ]
      },
      "ParticipantControlPayload": {
        "type": "object",
        "description": "선생님이 학생 한 명의 마이크·카메라·판서 허용을 바꿉니다. 한 번에 하나 이상 지정합니다.",
        "properties": {
          "userId": {
            "type": "string",
            "format": "uuid"
          },
          "microphone": {
            "type": "boolean"
          },
          "camera": {
            "type": "boolean"
          },
          "annotation": {
            "type": "boolean"
          }
        },
        "required": [
          "userId"
        ]
      },
      "ParticipantMediaRequest": {
        "type": "object",
        "description": "선생님이 요청한 마이크·카메라 상태입니다. 대상 학생의 현재 수업 연결에만 보냅니다.",
        "properties": {
          "lessonId": {
            "type": "string",
            "format": "uuid"
          },
          "userId": {
            "type": "string",
            "format": "uuid"
          },
          "requestedBy": {
            "type": "string",
            "format": "uuid"
          },
          "microphone": {
            "type": "boolean"
          },
          "camera": {
            "type": "boolean"
          }
        },
        "required": [
          "lessonId",
          "userId",
          "requestedBy"
        ]
      },
      "AssistanceGeometry": {
        "type": "object",
        "x-feature": "meeting.remote-assistance",
        "properties": {
          "width": {
            "type": "integer",
            "minimum": 1,
            "maximum": 16384
          },
          "height": {
            "type": "integer",
            "minimum": 1,
            "maximum": 16384
          },
          "rotation": {
            "type": "integer",
            "enum": [
              0,
              90,
              180,
              270
            ]
          },
          "version": {
            "type": "integer",
            "minimum": 1
          }
        },
        "required": [
          "width",
          "height",
          "rotation",
          "version"
        ]
      },
      "AssistanceSession": {
        "type": "object",
        "x-feature": "meeting.remote-assistance",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "teacherId": {
            "type": "string"
          },
          "studentId": {
            "type": "string"
          },
          "status": {
            "type": "string",
            "enum": [
              "pending",
              "approved",
              "active"
            ]
          },
          "expiresAt": {
            "type": "string",
            "format": "date-time",
            "nullable": true
          },
          "shareId": {
            "type": "string"
          },
          "geometry": {
            "$ref": "#/components/schemas/AssistanceGeometry"
          }
        },
        "required": [
          "id",
          "teacherId",
          "studentId",
          "status",
          "expiresAt"
        ]
      },
      "AssistancePointer": {
        "type": "object",
        "x-feature": "meeting.remote-assistance",
        "properties": {
          "lessonId": {
            "type": "string",
            "format": "uuid"
          },
          "sessionId": {
            "type": "string",
            "format": "uuid"
          },
          "shareId": {
            "type": "string",
            "format": "uuid"
          },
          "geometryVersion": {
            "type": "integer",
            "minimum": 1
          },
          "x": {
            "type": "number",
            "minimum": 0,
            "maximum": 1
          },
          "y": {
            "type": "number",
            "minimum": 0,
            "maximum": 1
          },
          "authorId": {
            "type": "string"
          }
        },
        "required": [
          "lessonId",
          "sessionId",
          "shareId",
          "geometryVersion",
          "x",
          "y"
        ]
      },
      "AssistanceRequestPayload": {
        "type": "object",
        "x-feature": "meeting.remote-assistance",
        "properties": {
          "studentId": {
            "type": "string",
            "format": "uuid"
          }
        },
        "required": [
          "studentId"
        ]
      },
      "AssistanceRespondPayload": {
        "type": "object",
        "x-feature": "meeting.remote-assistance",
        "properties": {
          "sessionId": {
            "type": "string",
            "format": "uuid"
          },
          "approved": {
            "type": "boolean"
          }
        },
        "required": [
          "sessionId",
          "approved"
        ]
      },
      "AssistanceStartPayload": {
        "type": "object",
        "x-feature": "meeting.remote-assistance",
        "properties": {
          "sessionId": {
            "type": "string",
            "format": "uuid"
          },
          "geometry": {
            "$ref": "#/components/schemas/AssistanceGeometry"
          }
        },
        "required": [
          "sessionId",
          "geometry"
        ]
      },
      "AssistanceGeometryPayload": {
        "type": "object",
        "x-feature": "meeting.remote-assistance",
        "properties": {
          "sessionId": {
            "type": "string",
            "format": "uuid"
          },
          "geometry": {
            "$ref": "#/components/schemas/AssistanceGeometry"
          }
        },
        "required": [
          "sessionId",
          "geometry"
        ]
      },
      "AssistanceStopPayload": {
        "type": "object",
        "x-feature": "meeting.remote-assistance",
        "properties": {
          "sessionId": {
            "type": "string",
            "format": "uuid"
          }
        },
        "required": [
          "sessionId"
        ]
      },
      "ClassNoteLesson": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "title": {
            "type": "string"
          },
          "startsAt": {
            "type": "string",
            "format": "date-time"
          },
          "teacherName": {
            "type": "string"
          }
        },
        "required": [
          "id",
          "title",
          "startsAt",
          "teacherName"
        ]
      },
      "ClassNoteTarget": {
        "type": "object",
        "properties": {
          "lesson": {
            "allOf": [
              {
                "$ref": "#/components/schemas/ClassNoteLesson"
              }
            ],
            "nullable": true
          }
        },
        "required": [
          "lesson"
        ]
      },
      "ClassNoteImage": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          }
        },
        "required": [
          "id",
          "createdAt"
        ]
      },
      "ClassNoteWorksheet": {
        "type": "object",
        "properties": {
          "lesson": {
            "$ref": "#/components/schemas/ClassNoteLesson"
          },
          "studentName": {
            "type": "string"
          },
          "original": {
            "$ref": "#/components/schemas/ClassNoteImage"
          },
          "correction": {
            "allOf": [
              {
                "$ref": "#/components/schemas/ClassNoteImage"
              }
            ],
            "nullable": true
          }
        },
        "required": [
          "lesson",
          "studentName",
          "original",
          "correction"
        ]
      },
      "ClassNoteCapture": {
        "type": "object",
        "properties": {
          "lesson": {
            "$ref": "#/components/schemas/ClassNoteLesson"
          },
          "image": {
            "$ref": "#/components/schemas/ClassNoteImage"
          },
          "source": {
            "type": "string",
            "enum": [
              "self",
              "teacher"
            ]
          }
        },
        "required": [
          "lesson",
          "image",
          "source"
        ]
      },
      "StudentAttendanceStatus": {
        "type": "string",
        "x-feature": "classroom.attendance",
        "enum": [
          "PRESENT",
          "LATE",
          "ABSENT"
        ]
      },
      "StudentAttendanceReason": {
        "type": "string",
        "x-feature": "classroom.attendance",
        "enum": [
          "DEVICE",
          "NETWORK",
          "OTHER"
        ]
      },
      "StudentAttendanceStudent": {
        "type": "object",
        "x-feature": "classroom.attendance",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "name": {
            "type": "string"
          }
        },
        "required": [
          "id",
          "name"
        ]
      },
      "StudentAttendanceSummary": {
        "type": "object",
        "x-feature": "classroom.attendance",
        "properties": {
          "rate": {
            "type": "integer",
            "minimum": 0,
            "maximum": 100,
            "nullable": true
          },
          "present": {
            "type": "integer",
            "minimum": 0
          },
          "late": {
            "type": "integer",
            "minimum": 0
          },
          "absent": {
            "type": "integer",
            "minimum": 0
          }
        },
        "required": [
          "rate",
          "present",
          "late",
          "absent"
        ]
      },
      "StudentAttendanceRow": {
        "type": "object",
        "x-feature": "classroom.attendance",
        "properties": {
          "lessonId": {
            "type": "string",
            "format": "uuid"
          },
          "lessonTitle": {
            "type": "string"
          },
          "startsAt": {
            "type": "string",
            "format": "date-time"
          },
          "firstJoinedAt": {
            "type": "string",
            "format": "date-time",
            "nullable": true
          },
          "lastLeftAt": {
            "type": "string",
            "format": "date-time",
            "nullable": true
          },
          "durationSeconds": {
            "type": "integer",
            "minimum": 0
          },
          "status": {
            "$ref": "#/components/schemas/StudentAttendanceStatus"
          },
          "reason": {
            "allOf": [
              {
                "$ref": "#/components/schemas/StudentAttendanceReason"
              }
            ],
            "nullable": true
          },
          "memo": {
            "type": "string",
            "nullable": true,
            "maxLength": 500
          }
        },
        "required": [
          "lessonId",
          "lessonTitle",
          "startsAt",
          "firstJoinedAt",
          "lastLeftAt",
          "durationSeconds",
          "status",
          "reason",
          "memo"
        ]
      },
      "StudentAttendanceMonth": {
        "type": "object",
        "x-feature": "classroom.attendance",
        "properties": {
          "student": {
            "$ref": "#/components/schemas/StudentAttendanceStudent"
          },
          "month": {
            "type": "string",
            "pattern": "^[2-9]\\d{3}-(0[1-9]|1[0-2])$"
          },
          "summary": {
            "$ref": "#/components/schemas/StudentAttendanceSummary"
          },
          "rows": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/StudentAttendanceRow"
            }
          }
        },
        "required": [
          "student",
          "month",
          "summary",
          "rows"
        ]
      },
      "StudentAttendanceInput": {
        "type": "object",
        "x-feature": "classroom.attendance",
        "properties": {
          "status": {
            "$ref": "#/components/schemas/StudentAttendanceStatus"
          },
          "reason": {
            "allOf": [
              {
                "$ref": "#/components/schemas/StudentAttendanceReason"
              }
            ],
            "nullable": true
          },
          "memo": {
            "type": "string",
            "nullable": true,
            "maxLength": 500
          }
        },
        "required": [
          "status"
        ]
      },
      "PrejoinStudent": {
        "type": "object",
        "required": [
          "id",
          "name"
        ],
        "properties": {
          "id": {
            "type": "string"
          },
          "name": {
            "type": "string"
          }
        }
      },
      "PrejoinStatus": {
        "type": "object",
        "required": [
          "status"
        ],
        "properties": {
          "status": {
            "type": "string",
            "enum": [
              "SCHEDULED",
              "LIVE",
              "ENDED",
              "CANCELLED"
            ]
          },
          "waitingStudents": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/PrejoinStudent"
            }
          }
        }
      }
    }
  }
} as const;
