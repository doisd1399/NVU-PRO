// Local bridge for the established backend API, backed only by modular Admin SDK APIs.
import * as appsApi from "firebase-admin/app";
import * as firestoreApi from "firebase-admin/firestore";
import * as messagingApi from "firebase-admin/messaging";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";
export let apps = appsApi.getApps();
export const app = appsApi.getApp;
export async function deleteApp(value: appsApi.App) { await appsApi.deleteApp(value); apps = appsApi.getApps(); }
export function initializeApp(options?: appsApi.AppOptions, name?: string) {
  const result = appsApi.initializeApp(options, name); apps = appsApi.getApps(); return result;
}
export const credential = { applicationDefault: appsApi.applicationDefault, cert: appsApi.cert };
export const auth = getAuth;
export const storage = getStorage;
export function firestore() { return firestoreApi.getFirestore(); }
export namespace firestore {
  export const FieldValue = firestoreApi.FieldValue;
  export const FieldPath = firestoreApi.FieldPath;
  export const Timestamp = firestoreApi.Timestamp;
  export type Timestamp = firestoreApi.Timestamp;
  export type Firestore = firestoreApi.Firestore;
  export type DocumentData = firestoreApi.DocumentData;
}
export function messaging() { return messagingApi.getMessaging(); }
export namespace messaging {
  export type BatchResponse = messagingApi.BatchResponse;
  export type MulticastMessage = messagingApi.MulticastMessage;
}
