import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth"; // Importera Auth-modulen
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries
import { getStorage } from "firebase/storage";
// tysta varningar
import { setLogLevel } from "firebase/app";
// Ange önskad loggnivå
setLogLevel("silent"); // Tysta loggnivån

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDfh94gHvxpHWlMq-8yzjp-2dfd-nXibjM",
  authDomain: "kudoo-36de9.firebaseapp.com",
  projectId: "kudoo-36de9",
  storageBucket: "kudoo-36de9.firebasestorage.app",
  messagingSenderId: "10789844466",
  appId: "1:10789844466:web:ca6c4e916b5013686b276b",
  measurementId: "G-EXHLTWFB7S",
};

// Initialisera Firebase-appen
const firebaseApp = initializeApp(firebaseConfig);

// Hämta Firestore-databasen
export const database = getFirestore(firebaseApp);

// Hämta Storage-databasen
export const storage = getStorage(firebaseApp);

// Hämta Auth-instansen
export const auth = getAuth(firebaseApp);


