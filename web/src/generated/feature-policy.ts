// Generated from features/catalog.json and contracts/. Do not edit.
export const CONTRACT_REVISION = 6 as const;
export const CAPABILITY_HEADERS = {"platform":"X-ThinkMeet-Platform","revision":"X-ThinkMeet-Contract-Revision"} as const;
export type ClientPlatform = "web" | "android" | "ios";
export type FeatureDefinition = { readonly id: string; readonly stage: "baseline" | "planned" | "in-progress" | "ready"; readonly requiresRevision: number; readonly defaultEnabled: boolean; readonly platforms: readonly ClientPlatform[] };
export const FEATURE_DEFINITIONS = [
  {
    "id": "classroom.core",
    "stage": "baseline",
    "requiresRevision": 0,
    "defaultEnabled": true,
    "platforms": [
      "web",
      "android",
      "ios"
    ]
  },
  {
    "id": "meeting.pip",
    "stage": "baseline",
    "requiresRevision": 0,
    "defaultEnabled": true,
    "platforms": [
      "android",
      "ios"
    ]
  },
  {
    "id": "meeting.remote-assistance",
    "stage": "in-progress",
    "requiresRevision": 4,
    "defaultEnabled": true,
    "platforms": [
      "web",
      "android",
      "ios"
    ]
  },
  {
    "id": "classroom.notes",
    "stage": "in-progress",
    "requiresRevision": 6,
    "defaultEnabled": true,
    "platforms": [
      "web",
      "android",
      "ios"
    ]
  }
] as const satisfies readonly FeatureDefinition[];
export type FeatureId = typeof FEATURE_DEFINITIONS[number]["id"];
export const HTTP_OPERATIONS: readonly { id: string; method: string; path: string; feature?: string; cleanup?: boolean }[] = [
  {
    "id": "health",
    "method": "GET",
    "path": "/api/v1/health"
  },
  {
    "id": "capabilities",
    "method": "GET",
    "path": "/api/v1/capabilities"
  },
  {
    "id": "authMe",
    "method": "GET",
    "path": "/api/v1/auth/me"
  },
  {
    "id": "authLogin",
    "method": "POST",
    "path": "/api/v1/auth/login"
  },
  {
    "id": "authLogout",
    "method": "POST",
    "path": "/api/v1/auth/logout"
  },
  {
    "id": "listStudents",
    "method": "GET",
    "path": "/api/v1/students",
    "feature": "classroom.core"
  },
  {
    "id": "listLessons",
    "method": "GET",
    "path": "/api/v1/lessons",
    "feature": "classroom.core"
  },
  {
    "id": "createLesson",
    "method": "POST",
    "path": "/api/v1/lessons",
    "feature": "classroom.core"
  },
  {
    "id": "resolveLesson",
    "method": "GET",
    "path": "/api/v1/join/{code}",
    "feature": "classroom.core"
  },
  {
    "id": "getLesson",
    "method": "GET",
    "path": "/api/v1/lessons/{id}",
    "feature": "classroom.core"
  },
  {
    "id": "updateLesson",
    "method": "PATCH",
    "path": "/api/v1/lessons/{id}",
    "feature": "classroom.core"
  },
  {
    "id": "cancelLesson",
    "method": "POST",
    "path": "/api/v1/lessons/{id}/cancel",
    "feature": "classroom.core"
  },
  {
    "id": "connectedLesson",
    "method": "POST",
    "path": "/api/v1/lessons/{id}/connected",
    "feature": "classroom.core"
  },
  {
    "id": "endLesson",
    "method": "POST",
    "path": "/api/v1/lessons/{id}/end",
    "cleanup": true
  },
  {
    "id": "joinLesson",
    "method": "POST",
    "path": "/api/v1/lessons/{id}/join",
    "feature": "classroom.core"
  },
  {
    "id": "leaveLesson",
    "method": "POST",
    "path": "/api/v1/lessons/{id}/leave",
    "cleanup": true
  },
  {
    "id": "kickParticipant",
    "method": "POST",
    "path": "/api/v1/lessons/{id}/kick",
    "feature": "classroom.core"
  },
  {
    "id": "inviteStudents",
    "method": "POST",
    "path": "/api/v1/lessons/{id}/invites",
    "feature": "classroom.core"
  },
  {
    "id": "getSnapshot",
    "method": "GET",
    "path": "/api/v1/lessons/{id}/snapshot",
    "feature": "classroom.core"
  },
  {
    "id": "listMaterials",
    "method": "GET",
    "path": "/api/v1/materials",
    "feature": "classroom.core"
  },
  {
    "id": "uploadMaterial",
    "method": "POST",
    "path": "/api/v1/materials",
    "feature": "classroom.core"
  },
  {
    "id": "deleteMaterial",
    "method": "DELETE",
    "path": "/api/v1/materials/{id}",
    "feature": "classroom.core"
  },
  {
    "id": "getMaterialContent",
    "method": "GET",
    "path": "/api/v1/materials/{id}/content",
    "feature": "classroom.core"
  },
  {
    "id": "livekitWebhook",
    "method": "POST",
    "path": "/api/v1/webhooks/livekit"
  },
  {
    "id": "getClassNoteTarget",
    "method": "GET",
    "path": "/api/v1/class-notes/target",
    "feature": "classroom.notes"
  },
  {
    "id": "listClassNoteWorksheets",
    "method": "GET",
    "path": "/api/v1/class-notes/worksheets",
    "feature": "classroom.notes"
  },
  {
    "id": "submitClassNoteWorksheet",
    "method": "POST",
    "path": "/api/v1/class-notes/lessons/{id}/worksheets",
    "feature": "classroom.notes"
  },
  {
    "id": "submitClassNoteCorrection",
    "method": "POST",
    "path": "/api/v1/class-notes/worksheets/{id}/correction",
    "feature": "classroom.notes"
  },
  {
    "id": "listClassNoteCaptures",
    "method": "GET",
    "path": "/api/v1/class-notes/captures",
    "feature": "classroom.notes"
  },
  {
    "id": "saveClassNoteCapture",
    "method": "POST",
    "path": "/api/v1/class-notes/lessons/{id}/captures",
    "feature": "classroom.notes"
  },
  {
    "id": "getClassNoteImage",
    "method": "GET",
    "path": "/api/v1/class-notes/images/{id}",
    "feature": "classroom.notes"
  }
];
const COMMAND_FEATURES: Record<string, string | undefined> = {"chat.send":"classroom.core","hand.set":"classroom.core","share.start":"classroom.core","share.stop":undefined,"media.update":"classroom.core","document.page":"classroom.core","stroke.add":"classroom.core","stroke.erase":"classroom.core","annotation.undo":"classroom.core","annotation.redo":"classroom.core","annotation.clear":"classroom.core","assistance.request":"meeting.remote-assistance","assistance.respond":"meeting.remote-assistance","assistance.start":"meeting.remote-assistance","assistance.geometry":"meeting.remote-assistance","assistance.stop":undefined};
const EVENT_FEATURES: Record<string, string | undefined> = {"subscribe":"classroom.core","command":undefined,"stroke.preview":"classroom.core","snapshot":undefined,"lessons:changed":undefined,"room:error":undefined,"session:replaced":undefined,"assistance.pointer":"meeting.remote-assistance"};

function matchingOperation(method: string, input: string) {
  const route = input.split("?")[0].replace(/\/$/, "");
  const absolute = route.startsWith("/api/v1/") ? route : "/api/v1" + (route.startsWith("/") ? route : "/" + route);
  const parts = absolute.split("/");
  return HTTP_OPERATIONS.find(op => op.method === method.toUpperCase() && op.path.split("/").length === parts.length && op.path.split("/").every((part, index) => (part.startsWith("{") || part.startsWith(":")) ? Boolean(parts[index]) : part === parts[index]));
}
export const featureForHttp = (method: string, path: string): string | undefined => matchingOperation(method, path)?.feature;
export const isKnownHttpOperation = (method: string, path: string): boolean => matchingOperation(method, path) !== undefined;
export function featureForEvent(event: string, payload?: Record<string, unknown>): string | undefined {
  return event === "command" ? COMMAND_FEATURES[String(payload?.type)] : EVENT_FEATURES[event];
}
export function isKnownEvent(event: string, payload?: Record<string, unknown>): boolean {
  return event === "command" ? Object.prototype.hasOwnProperty.call(COMMAND_FEATURES, String(payload?.type)) : Object.prototype.hasOwnProperty.call(EVENT_FEATURES, event);
}
export const isKnownFeature = (id: string): boolean => FEATURE_DEFINITIONS.some(feature => feature.id === id);
export const baselineFeatureIds: readonly string[] = FEATURE_DEFINITIONS.filter(f => f.stage === "baseline" && f.defaultEnabled).map(f => f.id);
export function baselineFeatures(platform: string): Record<string, boolean> {
  return Object.fromEntries(FEATURE_DEFINITIONS.map(f => [f.id, f.stage === "baseline" && f.defaultEnabled && (f.platforms as readonly string[]).includes(platform)]));
}
