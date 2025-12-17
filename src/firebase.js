import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

// Use the explicit Firebase config you provided so auth works
const firebaseConfig = {
  apiKey: 'AIzaSyB4WQ29fZAVkQZH8Kno0H3mSjVNPx-MAwY',
  authDomain: 'unit3quiz-v005-aiden.firebaseapp.com',
  projectId: 'unit3quiz-v005-aiden',
  storageBucket: 'unit3quiz-v005-aiden.firebasestorage.app',
  messagingSenderId: '132186764086',
  appId: '1:132186764086:web:83658760cc92fd1cb83997',
}

const app = initializeApp(firebaseConfig)

export const auth = getAuth(app)
export const db = getFirestore(app)


