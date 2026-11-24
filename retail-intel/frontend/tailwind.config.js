/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: { extend: { colors: { brand: { 50: "#ecf7f8", 100: "#cdebee", 500: "#0e7c86", 600: "#0b6870", 700: "#09545a" } } } },
  plugins: [],
};
