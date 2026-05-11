import {
  collection,
  doc,
  getDoc,
  getDocs,
} from "firebase/firestore";
import type { User } from "@/stores/useUsersStore";
import { database } from "./firebaseConfig";

const USERS_COLLECTION = "users";
export const getDocument = async (collection: string, email: string) => {
  try {
    const docRef = doc(database, collection, email);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return docSnap.data();
    } else {
      console.log(`No such document in ${collection} with email ${email}!`);
      return null;
    }
  } catch (error) {
    console.log(
      `Error getting document in ${collection} with email ${email}:`,
      error,
    );
    return null;
  }
};

export const getDocuments = async (alias: string) => {
  try {
    const docsRef = collection(database, alias);
    const docsSnap = await getDocs(docsRef);
    return docsSnap.docs.map((doc) => doc.data());
  } catch (error) {
    console.log(`Error getting documents in ${alias}:`, error);
    return [];
  }
};

export async function getUserDays(userId: string) {
  try {
    const colRef = collection(database, USERS_COLLECTION, userId, "days");
    const snap = await getDocs(colRef);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (error) {
    console.log(`Error getting days for user ${userId}:`, error);
    return [];
  }
}

export async function getUsers(): Promise<User[]> {
  try {
    const colRef = collection(database, USERS_COLLECTION);
    const snap = await getDocs(colRef);
    return snap.docs.map((docSnap) => {
      const data = docSnap.data() as Record<string, unknown>;
      return {
        id: docSnap.id,
        ...data,
      } as User;
    });
  } catch (error) {
    console.log("Error getting users:", error);
    return [];
  }
}

