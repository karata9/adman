// firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

// إعدادات مشروع "خيرات الرافدين"
const firebaseConfig = {
    apiKey: "AIzaSyCecUHYY9aNdDjmLsjNMU0JTr7FBv2cuXs",
    authDomain: "sthmar-7bfd0.firebaseapp.com",
    projectId: "sthmar-7bfd0",
    storageBucket: "sthmar-7bfd0.firebasestorage.app",
    messagingSenderId: "927651931910",
    appId: "1:927651931910:web:ab383126e843fcf2136087"
};

// تهيئة الاتصال
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);
