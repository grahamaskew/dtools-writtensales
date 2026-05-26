// ============================================================
//  D-Tools Report App — Configuration
// ============================================================

const APP_CONFIG = {

  // Firebase credentials (from Firebase Console → Project Settings → Your Apps)
  firebase: {
    apiKey:            "AIzaSyD_NgxQz6RoGLISISjY0JRhNDgmCgUXago",
    authDomain:        "dtools-writtensales.firebaseapp.com",
    projectId:         "dtools-writtensales",
    storageBucket:     "dtools-writtensales.firebasestorage.app",
    messagingSenderId: "177642673396",
    appId:             "1:177642673396:web:cd867acda67733c2dcbaa1"
  },

  // Cloudflare Worker URL
  workerUrl: "https://dtools-proxy.gaskew44.workers.dev",

  // Mock mode: true = use test data, false = use real D-Tools API
  useMock: false,

  // App identity
  appName:     "D-Tools Report",
  appSubtitle: "Approved Estimates",
  appCategory: "Estimating Tool"

};
